import sqlite3
from datetime import datetime
from pathlib import Path

from sqlalchemy import select

from database import SessionLocal
from models import Meeting, TranscriptSegment


SQLITE_DB_PATH = Path(__file__).resolve().parent / "sidekick.db"


def parse_datetime(value):
    if isinstance(value, datetime):
        return value
    return datetime.fromisoformat(value)


def migrate():
    if not SQLITE_DB_PATH.exists():
        raise FileNotFoundError(
            f"SQLite database not found: {SQLITE_DB_PATH}"
        )

    sqlite_conn = sqlite3.connect(SQLITE_DB_PATH)
    sqlite_conn.row_factory = sqlite3.Row
    db = SessionLocal()

    try:

        meetings = sqlite_conn.execute(
            "SELECT id, title, transcript, notes, created_at "
            "FROM meetings ORDER BY id"
        ).fetchall()

        segments = sqlite_conn.execute(
            "SELECT id, meeting_id, time, text, created_at "
            "FROM transcript_segments ORDER BY id"
        ).fetchall()

        existing_meeting_ids = set(
            db.scalars(select(Meeting.id)).all()
        )

        meetings_added = 0

        for row in meetings:
            if row["id"] in existing_meeting_ids:
                continue

            db.add(
                Meeting(
                    id=row["id"],
                    title=row["title"],
                    transcript=row["transcript"],
                    notes=row["notes"],
                    created_at=parse_datetime(row["created_at"]),
                )
            )
            meetings_added += 1

        db.flush()

        existing_segment_ids = set(
            db.scalars(select(TranscriptSegment.id)).all()
        )

        segments_added = 0

        for row in segments:
            if row["id"] in existing_segment_ids:
                continue

            db.add(
                TranscriptSegment(
                    id=row["id"],
                    meeting_id=row["meeting_id"],
                    time=row["time"],
                    text=row["text"],
                    created_at=parse_datetime(row["created_at"]),
                )
            )
            segments_added += 1

        db.commit()

        print("Migration completed successfully!")
        print(f"Meetings copied: {meetings_added} of {len(meetings)}")
        print(
            f"Transcript segments copied: "
            f"{segments_added} of {len(segments)}"
        )

    except Exception:
        db.rollback()
        raise

    finally:
        db.close()
        sqlite_conn.close()


if __name__ == "__main__":
    migrate()