---
name: Password-only accounts
description: How accounts without an email are represented while the user schema requires a unique email value.
---

Password-only registration uses a synthetic address under `accounts.nexhub.invalid` because the current SQLite users table requires a unique, non-null email. Keep this address hidden from users and administrators, leave the account unverified, and do not use it for recovery or delivery.

**Why:** signup must not require an email, while rebuilding the existing users table would risk an unnecessary migration.

**How to apply:** if email editing or recovery is added, replace the synthetic address with a validated real email and explicitly update verification state before treating it as deliverable.
