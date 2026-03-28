"""
Background Task Service - Async job queue for translation tasks.

Decouples translation from HTTP request/response cycle.
Provides:
- Job queueing and state management
- Progress tracking
- Granular retry for failed batches
- Persistent state (in-memory, can be extended to SQLite)
- Smart context-batching for TOC runs and dashed-list runs
"""

import asyncio
import re
import uuid
from datetime import datetime
from enum import Enum
from typing import Optional, Callable, Dict, List, Any
from dataclasses import dataclass, field
from models.requests import Chunk, GlossaryEntry
from models.responses import TranslatedChunk


class JobState(str, Enum):
    QUEUED = "queued"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"


class BatchState(str, Enum):
    PENDING = "pending"
    TRANSLATING = "translating"
    COMPLETED = "completed"
    FAILED = "failed"


@dataclass
class TranslationBatch:
    """A batch of chunks to translate together."""
    id: str
    chunks: List[Chunk]
    state: BatchState = BatchState.PENDING
    results: List[TranslatedChunk] = field(default_factory=list)
    error: Optional[str] = None
    retry_count: int = 0
    max_retries: int = 3


@dataclass
class TranslationJob:
    """A translation job containing multiple batches."""
    id: str
    document_name: str
    batches: List[TranslationBatch]
    glossary: List[GlossaryEntry]
    state: JobState = JobState.QUEUED
    created_at: datetime = field(default_factory=datetime.now)
    started_at: Optional[datetime] = None
    completed_at: Optional[datetime] = None
    error: Optional[str] = None
    
    @property
    def progress(self) -> dict:
        """Calculate job progress."""
        total_chunks = sum(len(b.chunks) for b in self.batches)
        completed_chunks = sum(
            len(b.results) for b in self.batches 
            if b.state == BatchState.COMPLETED
        )
        failed_chunks = sum(
            len(b.chunks) for b in self.batches 
            if b.state == BatchState.FAILED
        )
        
        return {
            "total": total_chunks,
            "completed": completed_chunks,
            "failed": failed_chunks,
            "percent": int((completed_chunks / total_chunks * 100)) if total_chunks > 0 else 0
        }


# ─────────────────────────────────────────────────────────────────────────────
# Chunk-type detection for smart context-batching
# ─────────────────────────────────────────────────────────────────────────────

# TOC entry: "3.1 Some heading text . . . 71" or "10.8.4 Something 72"
_TOC_PATTERN = re.compile(
    r'^[\d]+[\d.]*\s+.{2,60}\s*\.{2,}\s*\d+\s*$'   # trailing dots + page
    r'|^[\d]+[\d.]*\s+.{2,60}\s+\d+\s*$',          # just trailing page number
    re.UNICODE
)

# List continuation: starts with – or - or * bullet (not a markdown "- " list marker,
# which the parser already handles — these are typographic dashes from MinerU)
_DASH_PATTERN = re.compile(r'^\s*[–—-]\s+\S')

TOC_BATCH_MAX = 10   # group up to 10 TOC entries per Gemini call
LIST_BATCH_MAX = 8   # group up to 8 dashed-list items per Gemini call


def _chunk_kind(content: str) -> str:
    """Return 'toc', 'dashlist', or 'normal'."""
    stripped = content.strip()
    if _TOC_PATTERN.match(stripped):
        return 'toc'
    if _DASH_PATTERN.match(stripped):
        return 'dashlist'
    return 'normal'


def _group_chunks_smart(chunks: List[Chunk]) -> List[List[Chunk]]:
    """
    Group consecutive chunks of the same run type into sub-batches.

    - TOC entries     → groups of up to TOC_BATCH_MAX
    - Dashed-list items → groups of up to LIST_BATCH_MAX
    - Everything else  → individual (group of 1)

    Each returned group is translated as a single Gemini call.
    """
    if not chunks:
        return []

    groups: List[List[Chunk]] = []
    current_group: List[Chunk] = [chunks[0]]
    current_kind = _chunk_kind(chunks[0].content)
    current_max = {"toc": TOC_BATCH_MAX, "dashlist": LIST_BATCH_MAX}.get(current_kind, 1)

    for chunk in chunks[1:]:
        kind = _chunk_kind(chunk.content)
        max_size = {"toc": TOC_BATCH_MAX, "dashlist": LIST_BATCH_MAX}.get(kind, 1)

        if kind == current_kind and kind != 'normal' and len(current_group) < current_max:
            current_group.append(chunk)
        else:
            groups.append(current_group)
            current_group = [chunk]
            current_kind = kind
            current_max = max_size

    groups.append(current_group)
    return groups


class TranslationQueue:
    """
    Manages translation jobs asynchronously.

    Features:
    - Queue multiple jobs
    - Process batches with rate limit awareness
    - Retry failed batches automatically
    - Provide progress updates via callbacks
    - Smart context-batching for TOC / dashed-list runs
    """
    
    def __init__(self):
        self.jobs: Dict[str, TranslationJob] = {}
        self._running = False
        self._task: Optional[asyncio.Task] = None
        self._job_queue: asyncio.Queue = asyncio.Queue()
        self._progress_callbacks: Dict[str, Callable] = {}
    
    def log(self, msg: str):
        """Debug logger."""
        import datetime as dt
        ts = dt.datetime.now().strftime("%H:%M:%S.%f")[:-3]
        print(f"[{ts}] [Queue] {msg}")
    
    async def start(self):
        """Start the background worker."""
        if self._running:
            return
        self._running = True
        self._task = asyncio.create_task(self._worker())
        self.log("Worker started")
    
    async def stop(self):
        """Stop the background worker."""
        self._running = False
        if self._task:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
        self.log("Worker stopped")
    
    def create_job(
        self,
        document_name: str,
        chunks: List[Chunk],
        glossary: List[GlossaryEntry],
        batch_size: int = 5
    ) -> str:
        """
        Create a new translation job.
        
        Args:
            document_name: Name of the document
            chunks: List of chunks to translate
            glossary: Glossary entries for translation
            batch_size: Number of chunks per batch
        
        Returns:
            Job ID
        """
        job_id = str(uuid.uuid4())[:8]
        
        # Split chunks into batches
        batches = []
        for i in range(0, len(chunks), batch_size):
            batch_chunks = chunks[i:i + batch_size]
            batch_id = f"{job_id}-{len(batches)}"
            batches.append(TranslationBatch(
                id=batch_id,
                chunks=batch_chunks
            ))
        
        job = TranslationJob(
            id=job_id,
            document_name=document_name,
            batches=batches,
            glossary=glossary
        )
        
        self.jobs[job_id] = job
        self.log(f"Created job {job_id}: {len(chunks)} chunks in {len(batches)} batches")
        
        return job_id
    
    async def submit_job(self, job_id: str, progress_callback: Optional[Callable] = None):
        """
        Submit a job for processing.
        
        Args:
            job_id: The job ID to submit
            progress_callback: Optional callback for progress updates
        """
        if job_id not in self.jobs:
            raise ValueError(f"Job {job_id} not found")
        
        if progress_callback:
            self._progress_callbacks[job_id] = progress_callback
        
        await self._job_queue.put(job_id)
        self.log(f"Job {job_id} submitted to queue")
    
    def get_job(self, job_id: str) -> Optional[TranslationJob]:
        """Get job by ID."""
        return self.jobs.get(job_id)
    
    def get_job_status(self, job_id: str) -> Optional[dict]:
        """Get job status as dictionary."""
        job = self.jobs.get(job_id)
        if not job:
            return None
        
        return {
            "id": job.id,
            "document_name": job.document_name,
            "state": job.state.value,
            "progress": job.progress,
            "created_at": job.created_at.isoformat(),
            "started_at": job.started_at.isoformat() if job.started_at else None,
            "completed_at": job.completed_at.isoformat() if job.completed_at else None,
            "error": job.error
        }
    
    def get_all_results(self, job_id: str) -> Optional[List[TranslatedChunk]]:
        """Get all translation results for a job."""
        job = self.jobs.get(job_id)
        if not job:
            return None
        
        results = []
        for batch in job.batches:
            results.extend(batch.results)
        return results
    
    async def _worker(self):
        """Background worker that processes jobs."""
        from services.gemini_service import translate_chunk, translate_chunks_batch
        
        while self._running:
            try:
                # Wait for job with timeout
                try:
                    job_id = await asyncio.wait_for(
                        self._job_queue.get(),
                        timeout=1.0
                    )
                except asyncio.TimeoutError:
                    continue
                
                job = self.jobs.get(job_id)
                if not job:
                    continue
                
                self.log(f"Processing job {job_id}")
                job.state = JobState.RUNNING
                job.started_at = datetime.now()
                
                # Process each batch
                for batch in job.batches:
                    if batch.state == BatchState.COMPLETED:
                        continue  # Skip already completed batches
                    
                    await self._process_batch(job, batch, translate_chunk, translate_chunks_batch)
                
                # Check if all batches completed
                all_completed = all(
                    b.state == BatchState.COMPLETED 
                    for b in job.batches
                )
                
                if all_completed:
                    job.state = JobState.COMPLETED
                    job.completed_at = datetime.now()
                    self.log(f"Job {job_id} completed successfully")
                else:
                    # Some batches failed
                    failed_count = sum(1 for b in job.batches if b.state == BatchState.FAILED)
                    job.state = JobState.FAILED
                    job.error = f"{failed_count} batches failed"
                    self.log(f"Job {job_id} completed with {failed_count} failed batches")
                
                # Notify completion
                if job_id in self._progress_callbacks:
                    callback = self._progress_callbacks[job_id]
                    callback(job.progress)
                
            except asyncio.CancelledError:
                break
            except Exception as e:
                self.log(f"Worker error: {e}")
    
    async def _process_batch(
        self,
        job: TranslationJob,
        batch: TranslationBatch,
        translate_fn: Callable,
        batch_translate_fn: Callable,
    ):
        """
        Process a single batch of chunks using smart context-batching.

        Consecutive TOC entries and dashed-list items are grouped into a single
        Gemini call via batch_translate_fn.  All other chunks are translated
        individually via translate_fn.  The skeleton and MD structure are
        completely unaffected because each chunk_id still maps to its own
        translation; we only change how many chunks go per API call.
        """
        batch.state = BatchState.TRANSLATING
        
        try:
            # Group chunks into smart sub-batches based on content type.
            sub_batches = _group_chunks_smart(batch.chunks)
            self.log(
                f"Batch {batch.id}: {len(batch.chunks)} chunks → "
                f"{len(sub_batches)} API calls (smart grouping)"
            )

            for sub in sub_batches:
                if len(sub) == 1:
                    # Single chunk — translate individually
                    result = await translate_fn(sub[0], job.glossary)
                    batch.results.append(result)
                else:
                    # Multi-chunk run (TOC / dashed-list) — one API call
                    results = await batch_translate_fn(sub, job.glossary)
                    batch.results.extend(results)

                # Notify progress after each sub-batch
                if job.id in self._progress_callbacks:
                    callback = self._progress_callbacks[job.id]
                    callback(job.progress)

                # Small pacing delay between API calls
                await asyncio.sleep(0.3)
            
            batch.state = BatchState.COMPLETED
            self.log(f"Batch {batch.id} completed")
            
        except Exception as e:
            self.log(f"Batch {batch.id} failed: {e}")
            batch.error = str(e)
            batch.retry_count += 1
            
            if batch.retry_count < batch.max_retries:
                # Re-queue for retry
                batch.state = BatchState.PENDING
                self.log(f"Batch {batch.id} will retry ({batch.retry_count}/{batch.max_retries})")
            else:
                batch.state = BatchState.FAILED
                self.log(f"Batch {batch.id} exceeded max retries")


# Global queue instance
translation_queue = TranslationQueue()


async def get_queue() -> TranslationQueue:
    """Get the global translation queue, starting it if needed."""
    if not translation_queue._running:
        await translation_queue.start()
    return translation_queue
