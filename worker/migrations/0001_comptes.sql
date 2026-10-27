-- Comptes Foulée : inscription sur invitation, connexion par passkey (Face ID, empreinte).
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  prenom TEXT NOT NULL,
  is_admin INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE TABLE credentials (
  id TEXT PRIMARY KEY,            -- identifiant de la passkey (base64url)
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  public_key TEXT NOT NULL,       -- base64url
  counter INTEGER NOT NULL DEFAULT 0,
  transports TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX credentials_user ON credentials(user_id);

-- Une invitation sert une seule fois. kind = 'join' (nouveau compte) ou 'recover' (nouvel appareil d'un compte existant).
CREATE TABLE invitations (
  code TEXT PRIMARY KEY,
  kind TEXT NOT NULL DEFAULT 'join',
  created_by TEXT NOT NULL REFERENCES users(id),
  for_user TEXT REFERENCES users(id),
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  used_by TEXT,
  used_at INTEGER
);

CREATE TABLE challenges (
  id TEXT PRIMARY KEY,
  challenge TEXT NOT NULL,
  purpose TEXT NOT NULL,          -- 'register' | 'login'
  data TEXT,                      -- JSON : prénom, code d'invitation, identifiant utilisateur
  expires_at INTEGER NOT NULL
);

-- Seul le hachage du jeton est stocké : une fuite de la base ne donne accès à aucun compte.
CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX sessions_user ON sessions(user_id);

-- Données de l'app d'un utilisateur (historique, séances, réglages), privées.
CREATE TABLE user_data (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  data TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
