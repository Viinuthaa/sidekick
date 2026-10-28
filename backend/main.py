
from contextlib import asynccontextmanager
from datetime import datetime

from fastapi import Depends, FastAPI, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

import models
from database import Base, SessionLocal, engine


@asynccontextmanager
async def lifespan(app: FastAPI):
    Base.metadata.create_all(bind=engine)
    yield


app = FastAPI(
    title="Sidekick API",
    description="Backend API for the Sidekick meeting copilot.",
    version="0.4.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


class MeetingCreate(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    transcript: str = ""
    notes: str = ""


class MeetingUpdate(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=200)
    transcript: str | None = None
    notes: str | None = None


class MeetingResponse(BaseModel):
    id: int
    title: str
    transcript: str
    notes: str
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class TranscriptSegmentCreate(BaseModel):
    time: str = Field(min_length=1, max_length=30)
    text: str = Field(min_length=1)


class TranscriptSegmentResponse(BaseModel):
    id: int
    meeting_id: int
    time: str
    text: str

    model_config = ConfigDict(from_attributes=True)


@app.get("/")
def root():
    return {
        "name": "Sidekick API",
        "message": "Your backend is running.",
        "docs": "/docs",
    }


@app.get("/api/health")
def health_check():
    return {"status": "ok", "service": "sidekick-api"}


@app.get("/api/database/health")
def database_health_check(db: Session = Depends(get_db)):
    db.execute(select(1))
    return {"status": "ok", "database": "connected"}


@app.post(
    "/api/meetings",
    response_model=MeetingResponse,
    status_code=status.HTTP_201_CREATED,
)
def create_meeting(
    meeting_data: MeetingCreate,
    db: Session = Depends(get_db),
):
    title = meeting_data.title.strip()
    if not title:
        raise HTTPException(
            status_code=422,
            detail="Meeting title cannot be empty.",
        )

    meeting = models.Meeting(
        title=title,
        transcript=meeting_data.transcript,
        notes=meeting_data.notes,
    )
    db.add(meeting)
    db.commit()
    db.refresh(meeting)
    return meeting


@app.get("/api/meetings", response_model=list[MeetingResponse])
def list_meetings(db: Session = Depends(get_db)):
    statement = select(models.Meeting).order_by(models.Meeting.id.desc())
    return db.scalars(statement).all()


@app.get("/api/meetings/{meeting_id}", response_model=MeetingResponse)
def get_meeting(meeting_id: int, db: Session = Depends(get_db)):
    meeting = db.get(models.Meeting, meeting_id)
    if meeting is None:
        raise HTTPException(status_code=404, detail="Meeting not found.")
    return meeting


@app.patch("/api/meetings/{meeting_id}", response_model=MeetingResponse)
def update_meeting(
    meeting_id: int,
    meeting_data: MeetingUpdate,
    db: Session = Depends(get_db),
):
    meeting = db.get(models.Meeting, meeting_id)
    if meeting is None:
        raise HTTPException(status_code=404, detail="Meeting not found.")

    updates = meeting_data.model_dump(exclude_unset=True)

    if "title" in updates:
        title = (updates["title"] or "").strip()
        if not title:
            raise HTTPException(
                status_code=422,
                detail="Meeting title cannot be empty.",
            )
        updates["title"] = title

    for field, value in updates.items():
        setattr(meeting, field, value)

    db.commit()
    db.refresh(meeting)
    return meeting


@app.post(
    "/api/meetings/{meeting_id}/segments",
    response_model=TranscriptSegmentResponse,
    status_code=status.HTTP_201_CREATED,
)
def create_transcript_segment(
    meeting_id: int,
    segment_data: TranscriptSegmentCreate,
    db: Session = Depends(get_db),
):
    meeting = db.get(models.Meeting, meeting_id)
    if meeting is None:
        raise HTTPException(status_code=404, detail="Meeting not found.")

    text = segment_data.text.strip()
    if not text:
        raise HTTPException(
            status_code=422,
            detail="Transcript segment cannot be empty.",
        )

    segment = models.TranscriptSegment(
        meeting_id=meeting_id,
        time=segment_data.time,
        text=text,
    )

    # Keep the full transcript field up to date for existing frontend code.
    existing_transcript = meeting.transcript.strip()
    meeting.transcript = (
        f"{existing_transcript} {text}"
        if existing_transcript
        else text
    )

    db.add(segment)
    db.commit()
    db.refresh(segment)

    return segment


@app.get(
    "/api/meetings/{meeting_id}/segments",
    response_model=list[TranscriptSegmentResponse],
)
def list_transcript_segments(
    meeting_id: int,
    db: Session = Depends(get_db),
):
    meeting = db.get(models.Meeting, meeting_id)
    if meeting is None:
        raise HTTPException(status_code=404, detail="Meeting not found.")

    statement = (
        select(models.TranscriptSegment)
        .where(models.TranscriptSegment.meeting_id == meeting_id)
        .order_by(models.TranscriptSegment.id.asc())
    )

    return db.scalars(statement).all()


@app.delete(
    "/api/meetings/{meeting_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
def delete_meeting(meeting_id: int, db: Session = Depends(get_db)):
    meeting = db.get(models.Meeting, meeting_id)
    if meeting is None:
        raise HTTPException(status_code=404, detail="Meeting not found.")

    db.execute(
        delete(models.TranscriptSegment).where(
            models.TranscriptSegment.meeting_id == meeting_id
        )
    )

    db.delete(meeting)
    db.commit()
