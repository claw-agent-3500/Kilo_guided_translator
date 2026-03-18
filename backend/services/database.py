"""
Database Service - SQLite management for iterative translation workflow.

Tables:
- documents: Parsed documents
- nodes: Text blocks with translation state
- translations: Translation history
"""

import sqlite3
import os
from datetime import datetime
from enum import Enum
from typing import Optional, List, Dict, Any
from contextlib import contextmanager
from dataclasses import dataclass


class NodeState(str, Enum):
    """Translation workflow states."""
    PENDING = "pending"           # Extracted, waiting for translation
    TRANSLATING = "translating"   # Currently being translated
    REVIEW_REQUIRED = "review"    # Needs human review
    APPROVED = "approved"         # User verified
    COMPLETED = "completed"       # Final state
    FAILED = "failed"             # Translation failed


@dataclass
class Document:
    id: int
    name: str
    source_text: str
    pages: int
    word_count: int
    language: str
    created_at: datetime
    updated_at: datetime


@dataclass
class Node:
    id: int
    document_id: int
    index: int               # Position in document
    content: str             # Original text
    translation: Optional[str]
    state: NodeState
    confidence: Optional[float]
    block_type: str          # header, paragraph, etc.
    created_at: datetime
    updated_at: datetime


class Database:
    """SQLite database manager for translation workflow."""
    
    def __init__(self, db_path: str = "translator.db"):
        self.db_path = db_path
        self._init_db()
    
    def log(self, msg: str):
        import datetime as dt
        ts = dt.datetime.now().strftime("%H:%M:%S.%f")[:-3]
        print(f"[{ts}] [DB] {msg}")
    
    @contextmanager
    def get_connection(self):
        """Context manager for database connections."""
        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        try:
            yield conn
            conn.commit()
        except Exception as e:
            conn.rollback()
            raise e
        finally:
            conn.close()
    
    def _init_db(self):
        """Initialize database schema."""
        with self.get_connection() as conn:
            cursor = conn.cursor()
            
            # Documents table
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS documents (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    name TEXT NOT NULL,
                    source_text TEXT,
                    skeleton TEXT,
                    pages INTEGER DEFAULT 1,
                    word_count INTEGER DEFAULT 0,
                    language TEXT DEFAULT 'en',
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            """)

            # Migration: add skeleton column to existing documents tables
            try:
                cursor.execute("ALTER TABLE documents ADD COLUMN skeleton TEXT")
            except Exception:
                pass  # Column already exists
            
            # Nodes table (text blocks with state)
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS nodes (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    document_id INTEGER NOT NULL,
                    idx INTEGER NOT NULL,
                    content TEXT NOT NULL,
                    chunk_tag TEXT,
                    translation TEXT,
                    state TEXT DEFAULT 'pending',
                    confidence REAL,
                    block_type TEXT DEFAULT 'paragraph',
                    error_msg TEXT,
                    retry_count INTEGER DEFAULT 0,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY (document_id) REFERENCES documents(id)
                )
            """)

            # Migration: add chunk_tag column to existing nodes tables
            try:
                cursor.execute("ALTER TABLE nodes ADD COLUMN chunk_tag TEXT")
            except Exception:
                pass  # Column already exists
            
            # Translations history table
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS translations (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    node_id INTEGER NOT NULL,
                    translation TEXT NOT NULL,
                    source TEXT DEFAULT 'auto',
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY (node_id) REFERENCES nodes(id)
                )
            """)
            
            # Create indexes
            cursor.execute("CREATE INDEX IF NOT EXISTS idx_nodes_doc ON nodes(document_id)")
            cursor.execute("CREATE INDEX IF NOT EXISTS idx_nodes_state ON nodes(state)")
            cursor.execute("CREATE INDEX IF NOT EXISTS idx_translations_node ON translations(node_id)")
            
            self.log(f"Database initialized: {self.db_path}")
    
    # ==================== Document Operations ====================
    
    def create_document(
        self,
        name: str,
        source_text: str,
        pages: int = 1,
        word_count: int = 0,
        language: str = "en"
    ) -> int:
        """Create a new document and return its ID."""
        with self.get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("""
                INSERT INTO documents (name, source_text, pages, word_count, language)
                VALUES (?, ?, ?, ?, ?)
            """, (name, source_text, pages, word_count, language))
            doc_id = cursor.lastrowid
            self.log(f"Created document {doc_id}: {name}")
            return doc_id
    
    def get_document(self, doc_id: int) -> Optional[Dict]:
        """Get document by ID."""
        with self.get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("SELECT * FROM documents WHERE id = ?", (doc_id,))
            row = cursor.fetchone()
            return dict(row) if row else None
    
    def list_documents(self) -> List[Dict]:
        """List all documents."""
        with self.get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("SELECT * FROM documents ORDER BY created_at DESC")
            return [dict(row) for row in cursor.fetchall()]
    
    # ==================== Node Operations ====================
    
    def create_node(
        self,
        document_id: int,
        index: int,
        content: str,
        block_type: str = "paragraph"
    ) -> int:
        """Create a node for a text block."""
        with self.get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("""
                INSERT INTO nodes (document_id, idx, content, block_type, state)
                VALUES (?, ?, ?, ?, ?)
            """, (document_id, index, content, block_type, NodeState.PENDING.value))
            return cursor.lastrowid
    
    def create_nodes_batch(
        self,
        document_id: int,
        blocks: List[Dict]
    ) -> List[int]:
        """Create multiple nodes in batch."""
        with self.get_connection() as conn:
            cursor = conn.cursor()
            node_ids = []
            for i, block in enumerate(blocks):
                cursor.execute("""
                    INSERT INTO nodes (document_id, idx, content, chunk_tag, block_type, state)
                    VALUES (?, ?, ?, ?, ?, ?)
                """, (
                    document_id,
                    i,
                    block.get("content", ""),
                    block.get("chunk_tag"),       # None for legacy/non-skeleton nodes
                    block.get("type", "paragraph"),
                    NodeState.PENDING.value
                ))
                node_ids.append(cursor.lastrowid)
            self.log(f"Created {len(node_ids)} nodes for document {document_id}")
            return node_ids
    
    def get_node(self, node_id: int) -> Optional[Dict]:
        """Get node by ID."""
        with self.get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("SELECT * FROM nodes WHERE id = ?", (node_id,))
            row = cursor.fetchone()
            return dict(row) if row else None
    
    def get_document_nodes(self, document_id: int) -> List[Dict]:
        """Get all nodes for a document."""
        with self.get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("""
                SELECT * FROM nodes 
                WHERE document_id = ? 
                ORDER BY idx
            """, (document_id,))
            return [dict(row) for row in cursor.fetchall()]
    
    def get_nodes_by_state(
        self,
        document_id: int,
        state: NodeState
    ) -> List[Dict]:
        """Get nodes in a specific state."""
        with self.get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("""
                SELECT * FROM nodes 
                WHERE document_id = ? AND state = ?
                ORDER BY idx
            """, (document_id, state.value))
            return [dict(row) for row in cursor.fetchall()]
    
    def get_pending_nodes(self, document_id: int, limit: int = 50) -> List[Dict]:
        """Get pending nodes for translation."""
        with self.get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("""
                SELECT * FROM nodes 
                WHERE document_id = ? AND state = ?
                ORDER BY idx
                LIMIT ?
            """, (document_id, NodeState.PENDING.value, limit))
            return [dict(row) for row in cursor.fetchall()]
    
    def get_review_queue(self, document_id: Optional[int] = None) -> List[Dict]:
        """Get nodes needing review."""
        with self.get_connection() as conn:
            cursor = conn.cursor()
            if document_id:
                cursor.execute("""
                    SELECT n.*, d.name as document_name
                    FROM nodes n
                    JOIN documents d ON n.document_id = d.id
                    WHERE n.document_id = ? AND n.state = ?
                    ORDER BY n.idx
                """, (document_id, NodeState.REVIEW_REQUIRED.value))
            else:
                cursor.execute("""
                    SELECT n.*, d.name as document_name
                    FROM nodes n
                    JOIN documents d ON n.document_id = d.id
                    WHERE n.state = ?
                    ORDER BY d.id, n.idx
                """, (NodeState.REVIEW_REQUIRED.value,))
            return [dict(row) for row in cursor.fetchall()]
    
    # ==================== State Transitions ====================
    
    def update_node_state(
        self,
        node_id: int,
        state: NodeState,
        translation: Optional[str] = None,
        confidence: Optional[float] = None,
        error_msg: Optional[str] = None
    ) -> bool:
        """Update node state and optionally its translation."""
        with self.get_connection() as conn:
            cursor = conn.cursor()
            
            if translation is not None:
                cursor.execute("""
                    UPDATE nodes 
                    SET state = ?, translation = ?, confidence = ?, 
                        error_msg = ?, updated_at = CURRENT_TIMESTAMP
                    WHERE id = ?
                """, (state.value, translation, confidence, error_msg, node_id))
                
                # Save to history
                cursor.execute("""
                    INSERT INTO translations (node_id, translation, source)
                    VALUES (?, ?, ?)
                """, (node_id, translation, "auto"))
            else:
                cursor.execute("""
                    UPDATE nodes 
                    SET state = ?, error_msg = ?, updated_at = CURRENT_TIMESTAMP
                    WHERE id = ?
                """, (state.value, error_msg, node_id))
            
            return cursor.rowcount > 0
    
    def mark_translating(self, node_ids: List[int]) -> int:
        """Mark nodes as currently translating."""
        with self.get_connection() as conn:
            cursor = conn.cursor()
            placeholders = ",".join("?" * len(node_ids))
            cursor.execute(f"""
                UPDATE nodes 
                SET state = ?, updated_at = CURRENT_TIMESTAMP
                WHERE id IN ({placeholders})
            """, [NodeState.TRANSLATING.value] + node_ids)
            return cursor.rowcount
    
    def approve_node(self, node_id: int) -> bool:
        """Approve a node's translation."""
        return self.update_node_state(node_id, NodeState.APPROVED)
    
    def edit_node(self, node_id: int, new_translation: str) -> bool:
        """Edit a node's translation and mark for approval."""
        with self.get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("""
                UPDATE nodes 
                SET translation = ?, state = ?, updated_at = CURRENT_TIMESTAMP
                WHERE id = ?
            """, (new_translation, NodeState.APPROVED.value, node_id))
            
            # Save to history
            cursor.execute("""
                INSERT INTO translations (node_id, translation, source)
                VALUES (?, ?, ?)
            """, (node_id, new_translation, "manual"))
            
            return cursor.rowcount > 0
    
    def reset_for_retranslation(self, node_id: int) -> bool:
        """Reset node to pending for re-translation."""
        with self.get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("""
                UPDATE nodes 
                SET state = ?, retry_count = retry_count + 1, 
                    updated_at = CURRENT_TIMESTAMP
                WHERE id = ?
            """, (NodeState.PENDING.value, node_id))
            return cursor.rowcount > 0
    
    # ==================== Skeleton & State ====================

    def save_skeleton(self, document_id: int, skeleton: str) -> bool:
        """Persist the Markdown skeleton for a document."""
        with self.get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("""
                UPDATE documents SET skeleton = ?, updated_at = CURRENT_TIMESTAMP
                WHERE id = ?
            """, (skeleton, document_id))
            return cursor.rowcount > 0

    def get_skeleton(self, document_id: int) -> Optional[str]:
        """Retrieve the Markdown skeleton for a document. Returns None if not set."""
        with self.get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("SELECT skeleton FROM documents WHERE id = ?", (document_id,))
            row = cursor.fetchone()
            return row["skeleton"] if row else None

    def get_nodes_with_tags(
        self,
        document_id: int,
        include_pending: bool = False
    ) -> List[Dict]:
        """
        Retrieve (chunk_tag, content, translation, state) for all tagged nodes of a document.

        Args:
            include_pending: If True, also include pending/untranslated nodes
                             so the caller can substitute the original English.
        """
        with self.get_connection() as conn:
            cursor = conn.cursor()
            if include_pending:
                cursor.execute("""
                    SELECT chunk_tag, content, translation, state
                    FROM nodes
                    WHERE document_id = ? AND chunk_tag IS NOT NULL
                    ORDER BY idx
                """, (document_id,))
            else:
                cursor.execute("""
                    SELECT chunk_tag, content, translation, state
                    FROM nodes
                    WHERE document_id = ? AND chunk_tag IS NOT NULL
                          AND state IN ('approved', 'completed')
                    ORDER BY idx
                """, (document_id,))
            return [dict(row) for row in cursor.fetchall()]

    # ==================== Statistics ====================

    def get_document_stats(self, document_id: int) -> Dict:
        """Get translation statistics for a document."""
        with self.get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("""
                SELECT 
                    state,
                    COUNT(*) as count
                FROM nodes
                WHERE document_id = ?
                GROUP BY state
            """, (document_id,))
            
            stats = {state.value: 0 for state in NodeState}
            for row in cursor.fetchall():
                stats[row["state"]] = row["count"]
            
            total = sum(stats.values())
            completed = stats[NodeState.APPROVED.value] + stats[NodeState.COMPLETED.value]
            
            return {
                "total": total,
                "completed": completed,
                "pending": stats[NodeState.PENDING.value],
                "review_required": stats[NodeState.REVIEW_REQUIRED.value],
                "failed": stats[NodeState.FAILED.value],
                "progress_percent": int(completed / total * 100) if total > 0 else 0
            }


# Global database instance
_db: Optional[Database] = None


def get_database() -> Database:
    """Get or create the global database instance."""
    global _db
    if _db is None:
        db_path = os.environ.get("TRANSLATOR_DB", "translator.db")
        _db = Database(db_path)
    return _db
