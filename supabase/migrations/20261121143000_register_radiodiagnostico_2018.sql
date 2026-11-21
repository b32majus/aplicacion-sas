-- Radiodiagnóstico: segunda oposición real de Aplicación SAS.
-- Registro administrativo (SIN llaves de respuesta, permisos nuevos ni datos
-- personales). M01 filtra solo exam_id con registro oficial y mapeo explícito.
-- Insertar una oposición no publica ningún examen por sí mismo: fallo cerrado.
-- Los dos registros official_exam_versions se aplican por SQL revisado aparte
-- desde supabase/official-exam-registrations (una vez publicado el JSON).
-- No modificar Administrativo, usuarios, intentos ni respuestas.
insert into public.oppositions (id, public_name)
values ('radiodiagnostico', 'Radiodiagnóstico')
on conflict (id) do nothing;

insert into public.opposition_exams (exam_id, opposition_id) values
  ('sas-radiodiagnostico-2018-turno-libre', 'radiodiagnostico'),
  ('sas-radiodiagnostico-2018-promocion-interna', 'radiodiagnostico')
on conflict (exam_id) do nothing;

do $check_rx_mapping$
begin
  if not exists (
    select 1 from public.oppositions
    where id='radiodiagnostico' and public_name='Radiodiagnóstico'
  ) or (
    select count(*) from public.opposition_exams
    where exam_id in (
      'sas-radiodiagnostico-2018-turno-libre',
      'sas-radiodiagnostico-2018-promocion-interna'
    ) and opposition_id='radiodiagnostico'
  ) <> 2 then
    raise exception 'Registro Radiodiagnóstico en conflicto con las asignaciones aprobadas';
  end if;
end
$check_rx_mapping$;
