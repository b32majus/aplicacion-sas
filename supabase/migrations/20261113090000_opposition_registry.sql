-- Registro de oposiciones de la aplicación SAS (unidad m01-oposicion-oficial).
--
-- Operativa:
--   1. `public.oppositions` guarda el registro administrativo de oposiciones con
--      su nombre público; `public.opposition_exams` fija el mapeo explícito de
--      cada `exam_id` publicado hacia una oposición registrada. La oposición de
--      un examen NUNCA se infiere por prefijo del identificador: solo cuenta la
--      fila de mapeo explícita sembrada aquí.
--   2. Ambas tablas son propiedad administrativa: tienen RLS activada y no
--      conceden privilegios directos de lectura ni escritura a `anon` ni a
--      `authenticated`. El único acceso público autorizado es la RPC v2 de
--      metadata publicada definida más abajo.
--   3. La siembra registra exactamente una oposición (Administrativo) y mapea
--      exactamente los 12 exam_id del catálogo estático vigente. No se añaden ni
--      se eliminan filas en `public.official_exam_versions`: los registros
--      oficiales históricos permanecen intactos e inmutables.
--   4. Migración forward-only: no contiene operaciones destructivas y no toca
--      migraciones históricas.

create table public.oppositions (
  id text primary key,
  public_name text not null unique
);

create table public.opposition_exams (
  exam_id text primary key,
  opposition_id text not null references public.oppositions(id)
);

-- El registro es administrativo: sin políticas de RLS, cualquier rol que no sea
-- propietario no ve filas; el revoke adicional impide además cualquier acceso
-- directo por privilegio. La metadata sale únicamente por la RPC v2.
alter table public.oppositions enable row level security;
alter table public.opposition_exams enable row level security;

revoke all on table public.oppositions from public, anon, authenticated;
revoke all on table public.opposition_exams from public, anon, authenticated;

-- Siembra de la única oposición vigente en producción. Cualquier oposición nueva
-- (por ejemplo Radiodiagnóstico) llegará en su propia migración revisada, nunca
-- en esta.
insert into public.oppositions (id, public_name) values ('administrativo', 'Administrativo');

-- Mapeo administrativo explícito: cada exam_id del catálogo estático apunta a la
-- oposición registrada. Un examen publicado sin fila aquí no se expone por la
-- RPC v2 (fallo cerrado).
insert into public.opposition_exams (exam_id, opposition_id) values
  ('sas-administrativo-2015-promocion-interna', 'administrativo'),
  ('sas-administrativo-2015-turno-libre', 'administrativo'),
  ('sas-administrativo-2015-turno-libre-aplazada', 'administrativo'),
  ('sas-administrativo-2018-promocion-interna', 'administrativo'),
  ('sas-administrativo-2018-turno-libre', 'administrativo'),
  ('sas-administrativo-2021-promocion-interna', 'administrativo'),
  ('sas-administrativo-2021-promocion-interna-aplazada', 'administrativo'),
  ('sas-administrativo-2021-turno-libre', 'administrativo'),
  ('sas-administrativo-2021-turno-libre-aplazada', 'administrativo'),
  ('sas-administrativo-2023-turno-libre', 'administrativo'),
  ('sas-administrativo-2025-promocion-interna', 'administrativo'),
  ('sas-administrativo-2025-turno-libre', 'administrativo');

-- RPC v2 de metadata publicada: por cada versión oficial publicada CON mapeo
-- explícito devuelve la identidad del examen y la oposición a la que pertenece.
-- Nunca expone la clave de respuestas ni cualquier otro campo sensible; la
-- oposición se resuelve por la fila del mapeo, jamás por prefijo del exam_id.
-- La RPC v1 anterior sigue operativa sin cambios para el frontend antiguo.
create or replace function public.get_published_official_exam_versions_v2()
returns table (
  exam_id text,
  exam_version_id text,
  exam_version_path text,
  opposition_id text,
  opposition_name text
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    official.exam_id,
    official.exam_version_id,
    official.exam_version_path,
    mapped.opposition_id,
    opposition.public_name
  from public.official_exam_versions official
  join public.opposition_exams mapped
    on mapped.exam_id = official.exam_id
  join public.oppositions opposition
    on opposition.id = mapped.opposition_id
  where official.is_published
  order by official.exam_id, official.exam_version_id
$$;

revoke all on function public.get_published_official_exam_versions_v2()
  from public, anon, authenticated;
grant execute on function public.get_published_official_exam_versions_v2()
  to authenticated;
