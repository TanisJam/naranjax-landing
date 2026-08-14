/**
 * What each inner layer of the card has to say for itself.
 *
 * On this landing a layer is not a material any more — it is one thing the
 * account can do. That swap is the whole rebrand in one file: the card comes
 * apart into its features rather than into its laminates, so taking the stack
 * apart and reading the product list are the same gesture. The shape did not
 * have to change to allow it, which is the argument for the shape: a TITLE, one
 * line of claim, and a list of label/value pairs is a spec sheet whether the
 * subject is a film thickness or a rate.
 *
 * Copy is Naranja X's own, taken from naranjax.com — the voice is theirs
 * (voseo, "tu platita", "cuotitas fijas") and it is not to be flattened into
 * neutral Spanish on the next edit. The figures in `entries` are the ones the
 * site publishes; they are commercial terms and they move, so they belong here
 * as data rather than baked into any view.
 *
 * Pure data, no DOM and no Three.js, for the same reason `composition.ts` is:
 * the layer's identity is a property of the artwork, not of whatever happens to
 * be drawing it this week.
 *
 * Keyed by the ids in `composition.ts`. The two covers — `card-front` and
 * `card-back` — are deliberately absent: they are the card, not a layer of it,
 * and a click on either closes the stack rather than opening a panel. Missing
 * here IS the gesture, so adding an entry for a cover would silently change
 * what clicking it does.
 */

/** One row of the spec sheet. */
export interface SpecEntry {
  label: string
  value: string
}

/** Everything shown full-frame when a layer is opened. */
export interface LayerSpec {
  /** Matches `SheetLayer.id`. */
  layer: string
  /** Small label above the title. Which part of the product this belongs to. */
  eyebrow: string
  title: string
  /** One line. The claim the layer exists to make. */
  summary: string
  entries: readonly SpecEntry[]
}

export const layerSpecs: readonly LayerSpec[] = [
  {
    layer: 'transparent-blue',
    eyebrow: 'Tu cuenta',
    title: 'Cuenta gratis en minutos',
    summary: 'La abrís desde la app, con selfie y DNI, y la usás en el momento.',
    entries: [
      { label: 'Apertura', value: 'Sin costo' },
      { label: 'Mantenimiento', value: '$0 por mes' },
      { label: 'Alta', value: '100% online' },
    ],
  },
  {
    layer: 'glossy-light',
    eyebrow: 'Tu cuenta',
    title: 'Generá rendimientos',
    summary: 'La plata que dejás en tu cuenta rinde todos los días, findes y feriados incluidos.',
    entries: [
      { label: 'Tasa', value: '18% TNA' },
      { label: 'Acreditación', value: 'Diaria' },
      { label: 'Tope remunerado', value: '$1.000.000' },
    ],
  },
  {
    layer: 'mesh',
    eyebrow: 'Inversiones',
    title: 'Dale un lugar a cada peso',
    summary: 'Organizá en Frascos la plata para usar este mes o para más adelante.',
    entries: [
      { label: 'Producto', value: 'Frascos' },
      { label: 'Rinde', value: 'Mientras está guardada' },
      { label: 'Retiro', value: 'Cuando quieras' },
    ],
  },
  {
    layer: 'holo-currency',
    eyebrow: 'Inversiones',
    title: 'Dólares de lunes a lunes',
    summary: 'Comprá y vendé USD cuando quieras, incluso los findes y feriados.',
    entries: [
      { label: 'Cuenta', value: 'En dólares' },
      { label: 'Mantenimiento', value: 'Sin costo' },
      { label: 'Operás', value: 'Los 7 días' },
    ],
  },
  {
    layer: 'border-light',
    eyebrow: 'Préstamos',
    title: 'Préstamo en el acto',
    summary: 'Se acredita al instante en tu cuenta y lo devolvés en cuotitas fijas.',
    entries: [
      { label: 'Desde', value: '$500' },
      { label: 'Acreditación', value: 'Al instante' },
      { label: 'Historial', value: 'No hace falta' },
    ],
  },
  {
    layer: 'embossed-wave',
    eyebrow: 'Pagos',
    title: 'Pagá con QR',
    summary: 'Escaneá cualquier QR que veas, sin importar la marca, y pagá como quieras.',
    entries: [
      { label: 'Compatibilidad', value: 'Cualquier QR' },
      { label: 'En cuotas', value: 'Hasta $300.000' },
      { label: 'Costo', value: 'Sin cargo' },
    ],
  },
  {
    layer: 'holo-wave',
    eyebrow: 'Pagos',
    title: 'Transferí las 24 h',
    summary: 'Enviá y recibí dinero al instante usando CBU, CVU o alias.',
    entries: [
      { label: 'Disponible', value: 'Las 24 horas' },
      { label: 'Costo', value: 'Sin cargo' },
      { label: 'Destino', value: 'CBU, CVU o alias' },
    ],
  },
  {
    layer: 'translucent-emboss',
    eyebrow: 'Pagos',
    title: 'Servicios y recargas',
    summary: 'Ponete al día sin hacer filas y recargá el celu o el transporte desde la app.',
    entries: [
      { label: 'Servicios', value: 'Más de 4.000' },
      { label: 'Recargas', value: 'Celular y transporte' },
      { label: 'Dónde', value: 'Desde la app' },
    ],
  },
  {
    layer: 'solid-base',
    eyebrow: 'Beneficios',
    title: 'Descuentos todos los días',
    summary: 'Tu tarjeta de crédito o débito ya trae los beneficios activados.',
    entries: [
      { label: 'Cinemark', value: '2x1 todos los días' },
      { label: "McDonald's", value: '30% de ahorro' },
      { label: 'Indumentaria', value: '25% OFF y cuotas' },
    ],
  },
]

const byLayer = new Map(layerSpecs.map((spec) => [spec.layer, spec]))

/**
 * The spec for a layer, or null when that layer has none.
 *
 * Null is a meaningful answer and not a failure: it is how the covers say
 * "close the card instead". Whoever handles the click reads it that way.
 */
export function specFor(layerId: string): LayerSpec | null {
  return byLayer.get(layerId) ?? null
}
