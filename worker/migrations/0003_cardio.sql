-- Cardio importé depuis Santé (Apple Watch) par un Raccourci iPhone.
-- Le Raccourci s'authentifie avec un jeton d'import propre au compte : il ne peut
-- qu'ajouter des mesures, jamais lire les données. Seul son hachage est stocké.
CREATE TABLE cardio_tokens (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  last_used_at INTEGER,
  last_count INTEGER
);

-- Une mesure par instant : renvoyer deux fois le même Raccourci ne crée pas de doublon.
CREATE TABLE cardio_samples (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  t INTEGER NOT NULL,      -- instant de la mesure, ms depuis 1970 (UTC)
  bpm INTEGER NOT NULL,
  PRIMARY KEY (user_id, t)
) WITHOUT ROWID;
