-- Поля для «крупной» карточки турнира на главной — чтобы менять её ПОЛНОСТЬЮ из админки,
-- без правок кода. Название/даты/формат/сетка уже в БД; добавляем недостающее:
--   tg_url         : ссылка на пост-анонс в Telegram (она же — «Подробнее» и клик по картинке).
--   prize_pool     : призовой фонд карточки, свободный текст ('5 000 ₽', 'TBA', …).
--   announce_image : КЭШ картинки-анонса. Заполняется автоматически edge-функцией tg-image
--                    из tg_url (og:image поста). Можно и вписать руками — тогда tg_url не нужен.
alter table tournaments add column if not exists tg_url         text;
alter table tournaments add column if not exists prize_pool     text;
alter table tournaments add column if not exists announce_image text;
