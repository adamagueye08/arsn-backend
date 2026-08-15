-- Mot de passe oublié : jeton de réinitialisation à usage unique, avec expiration.
ALTER TABLE "users" ADD COLUMN "resetPasswordToken" TEXT;
ALTER TABLE "users" ADD COLUMN "resetPasswordExpiry" TIMESTAMP(3);
CREATE UNIQUE INDEX "users_resetPasswordToken_key" ON "users"("resetPasswordToken");
