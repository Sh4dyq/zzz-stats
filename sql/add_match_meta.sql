-- Метаданные встреч (encounters) для главной страницы и админки.
-- Запусти в Supabase SQL Editor. Весь клиентский код устойчив к отсутствию этих колонок
-- (сортирует/читает defensive), но без миграции тасование и стадии не сохранятся.

-- Ручной порядок встреч (drag-and-drop в админке «Матчи»); меньший = выше / раньше.
-- Им же определяется порядок «Последних матчей» на главной (statistics → главная).
alter table encounters add column if not exists sort_order int;

-- Стадия встречи: «Гранд-финал», «Финал верхней сетки» и т.п.
-- Пусто/NULL → на главной ничего не показывается.
alter table encounters add column if not exists stage text;

-- Дата проведения встречи (для «актуальности» в блоке последних матчей).
-- Если не задана — главная берёт created_at как приблизительную дату.
alter table encounters add column if not exists played_at date;
