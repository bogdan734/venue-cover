-- What a description's tags stand for, sealed with the program's key (AES-256-GCM, the classification id bound in).
-- Null when nothing personal was found, and for descriptions stored before the shield.
alter table classification add column vault text;
