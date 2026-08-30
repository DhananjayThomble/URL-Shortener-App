CREATE TABLE "job_leases" (
	"name" varchar(64) PRIMARY KEY NOT NULL,
	"locked_until" timestamp with time zone DEFAULT now() NOT NULL,
	"holder" varchar(120),
	"acquired_at" timestamp with time zone
);
