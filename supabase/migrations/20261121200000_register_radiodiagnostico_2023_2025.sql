-- RX tercero a quinto: 2023 Libre y 2025 Libre/PI.
-- Solo mapeos a oposición existente. Los paquetes se visibilizan
-- exclusivamente al registrar la versión oficial exacta y tener
-- sus PNG con SHA256 válidos en el banco, verificado antes de aplicar.
insert into public.opposition_exams(exam_id,opposition_id) values
 ('sas-radiodiagnostico-2023-turno-libre', 'radiodiagnostico'),
 ('sas-radiodiagnostico-2025-turno-libre', 'radiodiagnostico'),
 ('sas-radiodiagnostico-2025-promocion-interna', 'radiodiagnostico')
on conflict (exam_id) do nothing;

do $verify_mapped_rx_2023_2025$
begin
 if (select count(*) from public.opposition_exams
     where exam_id in (
      'sas-radiodiagnostico-2023-turno-libre',
      'sas-radiodiagnostico-2025-turno-libre',
      'sas-radiodiagnostico-2025-promocion-interna')
     and opposition_id='radiodiagnostico') <> 3 then
   raise exception 'Conflicto de asignaciones RX 2023/2025';
 end if;
end
$verify_mapped_rx_2023_2025$;
