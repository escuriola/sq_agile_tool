/**
 * 3.3333 -> "3h 20m". Los worklogs de Jira llegan en horas decimales periódicas
 * (un tercio de hora, un doceavo…) y en crudo son ilegibles. Se muestran así al
 * lado del valor, pero lo que se guarda es el decimal exacto: redondear a
 * cuartos de hora falsearía el tiempo invertido en un sentido u otro.
 */
export function hoursToHm(hours: number): string {
  if (!Number.isFinite(hours) || hours <= 0) return '';
  const totalMinutes = Math.round(hours * 60);
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  if (!h) return `${m}m`;
  return m ? `${h}h ${m}m` : `${h}h`;
}
