ALTER TABLE cardforge_deck_cards
  DROP CONSTRAINT cardforge_deck_cards_deck_id_fkey;
ALTER TABLE cardforge_deck_cards
  DROP CONSTRAINT cardforge_deck_cards_pkey;
ALTER TABLE cardforge_decks
  DROP CONSTRAINT cardforge_decks_pkey;

ALTER TABLE cardforge_deck_cards ADD COLUMN account_id text;
UPDATE cardforge_deck_cards c
SET account_id = d.account_id
FROM cardforge_decks d
WHERE d.deck_id = c.deck_id;
ALTER TABLE cardforge_deck_cards ALTER COLUMN account_id SET NOT NULL;

ALTER TABLE cardforge_decks
  ADD PRIMARY KEY (account_id, deck_id);
ALTER TABLE cardforge_deck_cards
  ADD PRIMARY KEY (account_id, deck_id, position);
ALTER TABLE cardforge_deck_cards
  ADD CONSTRAINT cardforge_deck_cards_deck_fkey
  FOREIGN KEY (account_id, deck_id)
  REFERENCES cardforge_decks(account_id, deck_id)
  ON DELETE CASCADE;
