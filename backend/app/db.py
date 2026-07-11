import enum
import logging
from sqlalchemy import create_engine, Column, String, Integer, Boolean, ForeignKey, Numeric, DateTime, Text, text
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.orm import declarative_base, sessionmaker, relationship
from sqlalchemy.sql import func
from app.config import settings

logger = logging.getLogger(__name__)

Base = declarative_base()

class ResidencyType(str, enum.Enum):
    """
    Specifies residency status for taxation rules.
    """
    Resident = "Resident"
    Non_Resident = "Non-Resident"

class EntityType(str, enum.Enum):
    """
    Represents legal entity classification.
    """
    Individual = "Individual"
    AOP = "AOP"
    Company = "Company"

class SpecialStatusType(str, enum.Enum):
    """
    Identifies special tax relief categories under FBR rules.
    """
    None_Status = "None"
    Ex_Serviceman = "Ex-Serviceman"
    Senior_Citizen = "Senior_Citizen"
    Disabled = "Disabled"
    Dependent_of_Shaheed = "Dependent_of_Shaheed"

class IncomeHeadType(str, enum.Enum):
    """
    Determines valid sources of income heads under NTR.
    """
    Salary = "Salary"
    Business = "Business"
    Property = "Property"

class User(Base):
    """
    System user identity and authentication mapping.
    """
    __tablename__ = "users"

    user_id = Column(UUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()"))
    email = Column(String(255), unique=True, nullable=False)
    full_name = Column(String(255))
    jurisdiction = Column(String(100), nullable=True, default="RTO Lahore")
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    profiles = relationship("TaxProfile", back_populates="user", cascade="all, delete-orphan")
    threads = relationship("ChatThread", back_populates="user", cascade="all, delete-orphan")

class TaxProfile(Base):
    """
    Aggregates statutory parameters for a taxpayer in a specific tax year.
    """
    __tablename__ = "tax_profiles"

    profile_id = Column(UUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()"))
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.user_id", ondelete="CASCADE"), nullable=False)
    tax_year = Column(Integer, nullable=False)
    is_atl_active = Column(Boolean, default=False)
    residency = Column(String(50), default="Resident")
    entity = Column(String(50), default="Individual")
    special_status = Column(String(50), default="None")
    jurisdiction = Column(String(100), nullable=True, default="RTO Lahore")
    wealth_statement_filed = Column(Boolean, default=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    user = relationship("User", back_populates="profiles")
    declarations = relationship("IncomeDeclaration", back_populates="profile", cascade="all, delete-orphan")

class IncomeDeclaration(Base):
    """
    Stores individual source incomes and adjustments declared by the taxpayer.
    """
    __tablename__ = "income_declarations"

    declaration_id = Column(UUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()"))
    profile_id = Column(UUID(as_uuid=True), ForeignKey("tax_profiles.profile_id", ondelete="CASCADE"), nullable=False)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.user_id", ondelete="CASCADE"), nullable=True)
    income_head = Column(String(50), nullable=False)
    gross_amount = Column(Numeric(15, 2), default=0.00)
    admissible_deductions = Column(Numeric(15, 2), default=0.00)
    currency = Column(String(3), default="PKR")
    last_updated = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    profile = relationship("TaxProfile", back_populates="declarations")

class ChatThread(Base):
    """
    Represents an ongoing interaction context containing memory calculations and references.
    """
    __tablename__ = "chat_threads"

    thread_id = Column(UUID(as_uuid=True), primary_key=True)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.user_id", ondelete="CASCADE"), nullable=False)
    title = Column(String(255), default="New Tax Inquiry")
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    last_accessed_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
    is_archived = Column(Boolean, default=False)
    
    calculation_cache = Column(JSONB, nullable=True)
    citations_cache = Column(JSONB, default=list)

    user = relationship("User", back_populates="threads")

engine = create_engine(settings.DATABASE_URL, pool_pre_ping=True)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

def get_db():
    """
    Context manager yielding a thread-local SQLAlchemy database session.
    """
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

def init_db():
    """
    Initializes PostgreSQL database schema, applies migrations, constraints, and indexes.
    """
    logger.info("Initializing PostgreSQL schema and indexes...")
    with engine.connect() as conn:
        conn.execute(text("CREATE EXTENSION IF NOT EXISTS \"uuid-ossp\";"))
        
        def create_enum_if_not_exists(enum_name, values):
            res = conn.execute(text(f"SELECT 1 FROM pg_type WHERE typname = '{enum_name}'"))
            if not res.fetchone():
                val_str = ", ".join([f"'{v}'" for v in values])
                conn.execute(text(f"CREATE TYPE {enum_name} AS ENUM ({val_str});"))
                logger.info(f"Created PostgreSQL enum type '{enum_name}'.")

        create_enum_if_not_exists("residency_type", ["Resident", "Non-Resident"])
        create_enum_if_not_exists("entity_type", ["Individual", "AOP", "Company"])
        create_enum_if_not_exists("special_status_type", ["None", "Ex-Serviceman", "Senior_Citizen", "Disabled", "Dependent_of_Shaheed"])
        create_enum_if_not_exists("income_head_type", ["Salary", "Business", "Property"])
        
        conn.commit()

    Base.metadata.create_all(bind=engine)

    _migrations = [
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS jurisdiction VARCHAR(100) DEFAULT 'RTO Lahore';",
        "ALTER TABLE tax_profiles ADD COLUMN IF NOT EXISTS jurisdiction VARCHAR(100) DEFAULT 'RTO Lahore';",
        "ALTER TABLE tax_profiles ADD COLUMN IF NOT EXISTS wealth_statement_filed BOOLEAN DEFAULT FALSE;",
        "ALTER TABLE chat_threads ADD COLUMN IF NOT EXISTS calculation_cache JSONB;",
        "ALTER TABLE chat_threads ADD COLUMN IF NOT EXISTS citations_cache JSONB DEFAULT '[]'::jsonb;",
        "ALTER TABLE income_declarations ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES users(user_id) ON DELETE CASCADE;",
    ]
    with engine.connect() as conn:
        for stmt in _migrations:
            try:
                with conn.begin():
                    conn.execute(text(stmt))
            except Exception as e:
                logger.debug(f"Migration skipped (likely already applied): {e}")

    with engine.connect() as conn:
        try:
            with conn.begin():
                conn.execute(text("ALTER TABLE tax_profiles ADD CONSTRAINT uq_user_tax_year UNIQUE (user_id, tax_year)"))
        except Exception:
            pass

        try:
            with conn.begin():
                conn.execute(text("ALTER TABLE income_declarations ADD CONSTRAINT uq_profile_income_head UNIQUE (profile_id, income_head)"))
        except Exception:
            pass

        try:
            with conn.begin():
                conn.execute(text("CREATE INDEX IF NOT EXISTS idx_tax_profiles_user ON tax_profiles(user_id);"))
                conn.execute(text("CREATE INDEX IF NOT EXISTS idx_income_profile ON income_declarations(profile_id);"))
                conn.execute(text("CREATE INDEX IF NOT EXISTS idx_income_declarations_user ON income_declarations(user_id);"))
                conn.execute(text("CREATE INDEX IF NOT EXISTS idx_chat_threads_user ON chat_threads(user_id);"))
        except Exception as e:
            logger.warning(f"Failed to apply indexes: {e}")

    logger.info("PostgreSQL database initialized successfully.")
