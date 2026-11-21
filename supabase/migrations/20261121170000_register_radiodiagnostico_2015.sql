-- Segundo lote RX: dos ejercicios reales OEP 2013-2015.
-- Aumenta el mapeo explícito de oposición sin tocar el histórico
-- de Administrativo ni modificar datos de usuario. Fail closed hasta
-- registro oficial de la versión publicada.
insert into public.opposition_exams (exam_id, opposition_id) values
  ('sas-radiodiagnostico-2015-turno-libre', 'radiodiagnostico'),
  ('sas-radiodiagnostico-2015-promocion-interna', 'radiodiagnostico')
on conflict (exam_id) do nothing;

do $verify_rx_2015$
begin
  if (select count(*) from public.opposition_exams
      where exam_id in ('sas-radiodiagnostico-2015-turno-libre',
                        'sas-radiodiagnostico-2015-promocion-interna')
      and opposition_id='radiodiagnostico') <> 2 then
    raise exception 'Conflicto de asignación en Radiodiagnóstico 2015';
  end if;
end
$verify_rx_2015$;
