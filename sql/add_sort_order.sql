-- Ручная сортировка списков в админке (drag-and-drop).
-- sort_order = позиция в списке (0..n); null → строка уходит в конец (стабильно).
-- Пишется из web/core.js enableReorder при перетаскивании; читается в refreshData.
alter table tournaments add column if not exists sort_order int;
alter table players     add column if not exists sort_order int;
