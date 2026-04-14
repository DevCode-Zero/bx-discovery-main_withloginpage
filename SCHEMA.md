# BX Discovery Data Schema


## Database Tables

### questions
| Column | Type | Description |
|--------|------|-------------|
| id | uuid | Primary key |
| question_text | text | Full question text/theme |
| short | text | Shortened question text |
| type | text | Question type (e.g., 'mcq', 'text') |
| options | jsonb | Array of options for MCQ questions |
| is_active | boolean | Whether question is active |
| session_id | uuid | Foreign key to session |
| created_at | timestamp | Creation timestamp |

### responses
| Column | Type | Description |
|--------|------|-------------|
| session_id | uuid | Foreign key to session |
| question_id | uuid | Foreign key to question |
| user_id | uuid | User identifier |
| answer | jsonb | User's answer ({selections: [], text: ''}) |
| created_at | timestamp | Creation timestamp |

### participants
| Column | Type | Description |
|--------|------|-------------|
| user_id | uuid | User identifier |
| session_id | uuid | Foreign key to session |
| last_seen | timestamp | Last activity timestamp |

**Unique constraint**: (user_id, session_id) on participants table

## Session
- Static session ID for MVP: `65b11313-808e-40b5-8c6d-e3344f910551`
