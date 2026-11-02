-- Autres mesures de la montre lues dans Santé par le Raccourci : distance (km),
-- énergie active (kcal), puissance de course (W), pas. Même règles que le cardio.
CREATE TABLE sante_samples (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,      -- 'dist' | 'kcal' | 'puiss' | 'pas'
  t INTEGER NOT NULL,      -- début de la mesure, ms depuis 1970 (UTC)
  v REAL NOT NULL,
  PRIMARY KEY (user_id, kind, t)
) WITHOUT ROWID;
