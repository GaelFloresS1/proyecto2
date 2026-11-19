import { useEffect, useState } from 'react'
import { Button, Card, Modal } from '../components'
import { formatDateTime, loadAttendanceReport, loadAttendanceReports } from '../store'

export default function HrReportHistory() {
  const [page, setPage] = useState(1)
  const [history, setHistory] = useState(null)
  const [selectedId, setSelectedId] = useState(null)

  useEffect(() => {
    let active = true
    loadAttendanceReports(page).then(result => {
      if (active) setHistory({ ...result, page })
    }).catch(() => {
      if (active) setHistory({ ok: false, page, message: 'No se pudo cargar el historial.' })
    })
    return () => { active = false }
  }, [page])

  const current = history?.page === page ? history : null
  return (
    <Card className="mb-5">
      <h2 className="font-display text-2xl text-cocoa">Historial de reportes de asistencia</h2>
      {!current && <p role="status" className="mt-2 text-sm text-cocoa-soft">Cargando historial…</p>}
      {current?.ok === false && <p role="alert" className="mt-2 text-sm text-berry">{current.message}</p>}
      {current?.ok && (
        <>
          {!current.reports.length && <p className="mt-2 text-sm text-cocoa-soft">Aún no hay reportes guardados.</p>}
          <ul className="divide-y divide-cocoa/10">
            {current.reports.map(report => (
              <li key={report.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <div>
                  <p className="font-semibold text-cocoa">Reporte #{report.id} · {report.periodStart} a {report.periodEnd}</p>
                  <p className="text-sm text-cocoa-soft">{formatDateTime(report.generatedAt)} · {report.generatedBy}</p>
                </div>
                <Button variant="ghost" onClick={() => setSelectedId(report.id)} aria-label={`Consultar reporte ${report.id}`}>
                  Consultar
                </Button>
              </li>
            ))}
          </ul>
          {(page > 1 || current.hasNext) && (
            <div className="mt-3 flex items-center gap-3">
              <Button variant="ghost" disabled={page === 1} onClick={() => setPage(page - 1)}>Anterior</Button>
              <span className="text-sm">Página {page}</span>
              <Button variant="ghost" disabled={!current.hasNext} onClick={() => setPage(page + 1)}>Siguiente</Button>
            </div>
          )}
        </>
      )}
      {selectedId !== null && <SavedReport key={selectedId} id={selectedId} onClose={() => setSelectedId(null)} />}
    </Card>
  )
}

function SavedReport({ id, onClose }) {
  const [result, setResult] = useState(null)
  useEffect(() => {
    let active = true
    loadAttendanceReport(id).then(response => {
      if (active) setResult(response)
    }).catch(() => {
      if (active) setResult({ ok: false, message: 'No se pudo cargar el reporte.' })
    })
    return () => { active = false }
  }, [id])

  const report = result?.ok ? result.report : null
  return (
    <Modal title={`Reporte de asistencia #${id}`} onClose={onClose}>
      {!result && <p role="status">Cargando reporte…</p>}
      {result?.ok === false && <p role="alert" className="text-sm text-berry">{result.message}</p>}
      {report && (
        <>
          <p>{report.periodStart} a {report.periodEnd}</p>
          <p className="text-sm text-cocoa-soft">{formatDateTime(report.generatedAt)} · {report.generatedBy}</p>
          <p className="my-3 text-sm text-cocoa-soft">El reporte guarda las horas clasificadas al momento de generarse. Importe estimado no aplicable.</p>
          <div className="max-h-[55vh] space-y-3 overflow-y-auto">
            {report.details.map(detail => (
              <section key={detail.employeeId} className="rounded-2xl bg-white p-3">
                <h4 className="font-semibold text-cocoa">{detail.employeeName}</h4>
                <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-2 text-sm">
                  <Metric label="Asistencias registradas" value={detail.attendances} />
                  <Metric label="Retardos registrados" value={detail.late} />
                  <Metric label="Horas normales clasificadas" value={`${detail.normal} h`} />
                  <Metric label="Horas extra clasificadas" value={`${detail.extra} h`} />
                  <Metric label="Horas festivas clasificadas" value={`${detail.holiday} h`} />
                  <Metric label="Jornadas con horas por revisar" value={detail.pendingHours} />
                  <Metric label="Faltas autorizadas" value={detail.authorizedAbsences} />
                  <Metric label="Faltas no autorizadas validadas" value={detail.unauthorizedAbsences} />
                  <Metric label="Registros de falta por revisar" value={detail.pendingAbsences} />
                  <Metric label="Permisos de salida autorizados" value={detail.authorizedExits} />
                </dl>
              </section>
            ))}
          </div>
        </>
      )}
    </Modal>
  )
}

function Metric({ label, value }) {
  return <div><dt className="text-cocoa-soft">{label}</dt><dd className="font-semibold">{value ?? 'No disponible'}</dd></div>
}
