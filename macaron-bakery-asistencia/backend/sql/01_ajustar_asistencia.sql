-- Ejecutar en phpMyAdmin, seleccionando la base de datos macaron_bakery.
-- Antes de continuar, revisa que no existan asistencias duplicadas por empleado y fecha:
-- SELECT id_empleado, fecha, COUNT(*) AS cantidad
-- FROM asistencia GROUP BY id_empleado, fecha HAVING COUNT(*) > 1;
-- Si devuelve filas, resuelve esos duplicados antes de crear el índice UNIQUE.

ALTER TABLE asistencia ENGINE = InnoDB;

-- Estas dos relaciones estaban apuntando incorrectamente a empleado.
ALTER TABLE asistencia
  DROP FOREIGN KEY fk_asistencia_registro_entrada,
  DROP FOREIGN KEY fk_asistencia_registro_salida;

-- En este alcance no se requiere una tabla separada de marcaciones:
-- asistencia conserva directamente fecha_hora_entrada y fecha_hora_salida.
ALTER TABLE asistencia
  DROP COLUMN id_registro_entrada,
  DROP COLUMN id_registro_salida;

-- Una sola fila de asistencia por empleado y día.
ALTER TABLE asistencia
  ADD UNIQUE KEY uq_asistencia_empleado_fecha (id_empleado, fecha);
