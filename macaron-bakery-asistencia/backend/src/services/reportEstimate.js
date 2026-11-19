export const DEFAULT_REPORT_RATES = Object.freeze({
  monthlyHours: 192,
  extraHourMultiplier: 1.5,
  holidayHourMultiplier: 2,
})

export function hourlyRate(salary, monthlyHours) {
  return salary / monthlyHours
}

export function estimateReportPay({ normal, extra, holidayHours }, salary, rates) {
  if (salary === null) return null
  const hour = hourlyRate(salary, rates.monthlyHours)
  const normalPay = normal * hour
  const extraPay = extra * hour * rates.extraHourMultiplier
  const holidayPay = holidayHours * hour * rates.holidayHourMultiplier

  return { hour, normalPay, extraPay, holidayPay, total: normalPay + extraPay + holidayPay }
}

const centsFormat = new Intl.NumberFormat('en-US', {
  useGrouping: false,
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

export function roundEstimatedPay(total) {
  return Number(centsFormat.format(total))
}
