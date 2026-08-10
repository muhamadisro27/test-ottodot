CREATE TABLE "bookings" (
	"id" serial PRIMARY KEY NOT NULL,
	"student_id" integer NOT NULL,
	"class_id" integer NOT NULL,
	"status" text DEFAULT 'pending_payment' NOT NULL,
	"created_at" bigint NOT NULL,
	"updated_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "parents" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	CONSTRAINT "parents_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "payment_attempts" (
	"id" serial PRIMARY KEY NOT NULL,
	"booking_id" integer NOT NULL,
	"amount" integer NOT NULL,
	"idempotency_key" text NOT NULL,
	"result" text NOT NULL,
	"reason" text,
	"created_at" bigint NOT NULL,
	CONSTRAINT "payment_attempts_idempotency_key_unique" UNIQUE("idempotency_key")
);
--> statement-breakpoint
CREATE TABLE "students" (
	"id" serial PRIMARY KEY NOT NULL,
	"parent_id" integer NOT NULL,
	"name" text NOT NULL,
	"grade" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "trial_classes" (
	"id" serial PRIMARY KEY NOT NULL,
	"subject" text NOT NULL,
	"topic" text NOT NULL,
	"starts_at" text NOT NULL,
	"capacity" integer DEFAULT 4 NOT NULL,
	"confirmed_count" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_class_id_trial_classes_id_fk" FOREIGN KEY ("class_id") REFERENCES "public"."trial_classes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_attempts" ADD CONSTRAINT "payment_attempts_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "students" ADD CONSTRAINT "students_parent_id_parents_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."parents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_booking_confirmed_student_class" ON "bookings" USING btree ("student_id","class_id") WHERE "bookings"."status" = 'confirmed';--> statement-breakpoint
CREATE INDEX "idx_booking_class_status" ON "bookings" USING btree ("class_id","status");--> statement-breakpoint
CREATE INDEX "idx_booking_student" ON "bookings" USING btree ("student_id");