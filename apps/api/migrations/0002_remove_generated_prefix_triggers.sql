DELETE FROM triggers
WHERE kind = 'prefix'
  AND (
    entity_id LIKE 'pokemon-%'
    OR entity_id LIKE 'riot-%'
    OR entity_id LIKE 'anilist-%'
  );
