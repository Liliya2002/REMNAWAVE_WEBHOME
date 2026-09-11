-- Сначала журнал активаций: promo_id объявлен как ON DELETE RESTRICT,
-- поэтому promo_codes без этого не удалится.
DROP TABLE IF EXISTS promo_code_uses;
DROP TABLE IF EXISTS promo_codes;
