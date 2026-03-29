"""
Review Router - API endpoints for iterative translation review workflow.
"""

import logging
from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel
from typing import Optional, List
from services.database import get_database, NodeState

logger = logging.getLogger(__name__)


router = APIRouter(prefix="/review", tags=["review"])


# ==================== Request/Response Models ====================

class EditRequest(BaseModel):
    translation: str


class NodeResponse(BaseModel):
    id: int
    document_id: int
    index: int
    content: str
    translation: Optional[str]
    state: str
    confidence: Optional[float]
    block_type: str
    document_name: Optional[str] = None


class StatsResponse(BaseModel):
    total: int
    completed: int
    pending: int
    review_required: int
    failed: int
    progress_percent: int


class ActionResponse(BaseModel):
    success: bool
    message: str


# ==================== Endpoints ====================

@router.get("/queue", response_model=List[NodeResponse])
async def get_review_queue(document_id: Optional[int] = Query(None)):
    """
    Get nodes that need human review.
    
    Args:
        document_id: Optional filter by document ID
    
    Returns:
        List of nodes with state='review'
    """
    db = get_database()
    nodes = db.get_review_queue(document_id)
    return [NodeResponse(**node) for node in nodes]


@router.get("/stats/{document_id}", response_model=StatsResponse)
async def get_document_stats(document_id: int):
    """
    Get translation statistics for a document.
    
    Returns counts by state and progress percentage.
    """
    db = get_database()
    stats = db.get_document_stats(document_id)
    return StatsResponse(**stats)


@router.get("/document/{document_id}/nodes", response_model=List[NodeResponse])
async def get_document_nodes(
    document_id: int,
    state: Optional[str] = Query(None)
):
    """
    Get all nodes for a document, optionally filtered by state.
    """
    db = get_database()
    
    if state:
        try:
            node_state = NodeState(state)
            nodes = db.get_nodes_by_state(document_id, node_state)
        except ValueError:
            raise HTTPException(400, f"Invalid state: {state}")
    else:
        nodes = db.get_document_nodes(document_id)
    
    return [NodeResponse(**node) for node in nodes]


@router.post("/{node_id}/approve", response_model=ActionResponse)
async def approve_node(node_id: int):
    """
    Approve a node's translation.
    
    Transitions: review -> approved
    """
    db = get_database()
    
    # Verify node exists
    node = db.get_node(node_id)
    if not node:
        raise HTTPException(404, f"Node {node_id} not found")
    
    # Check current state
    if node["state"] not in [NodeState.REVIEW_REQUIRED.value, NodeState.TRANSLATING.value]:
        raise HTTPException(400, f"Cannot approve node in state: {node['state']}")
    
    # Check has translation
    if not node.get("translation"):
        raise HTTPException(400, "Cannot approve node without translation")
    
    success = db.approve_node(node_id)
    
    if success:
        return ActionResponse(success=True, message=f"Node {node_id} approved")
    else:
        raise HTTPException(500, "Failed to approve node")


@router.post("/{node_id}/edit", response_model=ActionResponse)
async def edit_node(node_id: int, request: EditRequest):
    """
    Edit a node's translation and approve it.
    
    The previous translation is saved to history.
    """
    db = get_database()
    
    # Verify node exists
    node = db.get_node(node_id)
    if not node:
        raise HTTPException(404, f"Node {node_id} not found")
    
    if not request.translation.strip():
        raise HTTPException(400, "Translation cannot be empty")
    
    success = db.edit_node(node_id, request.translation)
    
    if success:
        return ActionResponse(success=True, message=f"Node {node_id} updated and approved")
    else:
        raise HTTPException(500, "Failed to update node")


@router.post("/{node_id}/retranslate", response_model=ActionResponse)
async def retranslate_node(node_id: int):
    """
    Queue a node for re-translation.
    
    Resets state to 'pending' so it will be picked up by the translation worker.
    """
    db = get_database()
    
    # Verify node exists
    node = db.get_node(node_id)
    if not node:
        raise HTTPException(404, f"Node {node_id} not found")
    
    success = db.reset_for_retranslation(node_id)
    
    if success:
        return ActionResponse(
            success=True, 
            message=f"Node {node_id} queued for re-translation (retry #{node['retry_count'] + 1})"
        )
    else:
        raise HTTPException(500, "Failed to queue node for retranslation")


@router.post("/batch/approve", response_model=ActionResponse)
async def batch_approve(node_ids: List[int]):
    """
    Approve multiple nodes at once.
    """
    db = get_database()
    
    approved = 0
    for node_id in node_ids:
        if db.approve_node(node_id):
            approved += 1
    
    return ActionResponse(
        success=True,
        message=f"Approved {approved}/{len(node_ids)} nodes"
    )


# ==================== Chunk Sync Endpoints ====================

class ChunkSyncResponse(BaseModel):
    """Response containing document chunks for frontend synchronization."""
    document_id: int
    document_name: str
    skeleton: str
    chunks: List[dict]  # List of {chunk_tag, content, index}


@router.get("/document/{document_id}/chunks", response_model=ChunkSyncResponse)
async def get_document_chunks(document_id: int):
    """
    Get all chunks for a document.
    
    This endpoint returns the chunks with their tags so the frontend
    can synchronize its translation state with the backend.
    """
    db = get_database()
    
    # Get document info
    doc = db.get_document(document_id)
    if not doc:
        raise HTTPException(404, f"Document {document_id} not found")
    
    # Get skeleton
    skeleton = db.get_skeleton(document_id)
    
    # Get all nodes with tags
    nodes = db.get_document_nodes(document_id)
    
    # Build chunks list with proper indexing
    chunks = []
    for node in nodes:
        if node.get("chunk_tag"):  # Only include tagged nodes
            chunks.append({
                "chunk_tag": node["chunk_tag"],
                "content": node["content"],
                "index": node["idx"],
                "translation": node.get("translation"),
                "state": node.get("state"),
                "node_id": node["id"],
                "block_type": node.get("block_type", "paragraph")
            })
    
    # Sort by index to ensure correct order
    chunks.sort(key=lambda x: x["index"])
    
    return ChunkSyncResponse(
        document_id=document_id,
        document_name=doc["name"],
        skeleton=skeleton or "",
        chunks=chunks
    )


class TranslationSaveRequest(BaseModel):
    """Request to save translations for multiple chunks."""
    translations: List[dict]  # List of {chunk_tag, translation, node_id}


@router.post("/document/{document_id}/translations", response_model=ActionResponse)
async def save_translations(document_id: int, request: TranslationSaveRequest):
    """
    Save translations for multiple chunks at once.
    
    This allows the frontend to synchronize its translation state
    with the backend database.
    """
    db = get_database()
    
    saved = 0
    for item in request.translations:
        chunk_tag = item.get("chunk_tag")
        translation = item.get("translation")
        node_id = item.get("node_id")
        
        if not all([chunk_tag, translation, node_id]):
            continue
        
        # Update node translation and set to review state
        success = db.update_node_state(
            node_id=node_id,
            state=NodeState.REVIEW_REQUIRED,
            translation=translation
        )
        if success:
            saved += 1
    
    return ActionResponse(
        success=True,
        message=f"Saved {saved}/{len(request.translations)} translations"
    )
