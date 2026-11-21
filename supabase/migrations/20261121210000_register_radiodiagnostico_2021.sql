-- Último lote RX: tres ejercicios OEP 2021 con imágenes.
-- Solo mapeos a la oposición existente, publicación fail-closed mediante
-- registros official_exam_versions precisos y assets multimedia verificados.
insert into public.opposition_exams (exam_id, opposition_id) values
  ('sas-radiodiagnostico-2021-turno-libre', 'radiodiagnostico'),
  ('sas-radiodiagnostico-2021-turno-libre-aplazada', 'radiodiagnostico'),
  ('sas-radiodiagnostico-2021-promocion-interna', 'radiodiagnostico')
on conflict (exam_id) do nothing;

do $verify_rx2021$
begin
 if (select count(*) from public.opposition_exams where
   exam_id in (
     'sas-radiodiagnostico-2021-turno-libre',
     'sas-radiodiagnostico-2021-turno-libre-aplazada',
     'sas-radiodiagnostico-2021-promocion-interna'
   ) and opposition_id='radiodiagnostico') <> 3 then
   raise exception 'Conflicto mapeo RX 2021';
 end if;
end
$verify_rx2021$;
