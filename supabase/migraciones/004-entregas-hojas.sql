-- El bucket privado de entregas solo aceptaba application/pdf.
--
-- Finance Study Lab empieza a vender una HERRAMIENTA, no solo libros: The
-- Valuation Sheet es un .xlsx. Sin esto el upload se rechaza con 415 y el
-- producto queda sin nada que entregar.
--
-- Se agregan los dos formatos de planilla (xlsx moderno y xls viejo) y csv, que
-- es el formato en el que uno exporta datos de una planilla. Nada mas: la lista
-- blanca es justamente lo que evita que por error entre un ejecutable al bucket
-- desde el que se sirven descargas pagas.
update storage.buckets
   set allowed_mime_types = array[
         'application/pdf',
         'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
         'application/vnd.ms-excel',
         'text/csv'
       ]
 where id = 'entregas';
