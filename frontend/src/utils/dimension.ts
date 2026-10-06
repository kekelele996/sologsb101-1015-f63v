/**
 * 树体尺寸与安全判定工具
 * - 胸径与冠幅单位换算
 * - 生长量年化
 * - 倾斜角与空洞安全阈值判定
 * - 加固件检查周期超期判定
 */
import type { Vigor } from '../types/review'
import type { SiteNote, Survey } from '../types/survey'
import { today } from './id'

/** 厘米 → 米（保留 3 位小数） */
export function cmToM(cm: number): number {
  return Math.round((cm / 100) * 1000) / 1000
}

/** 米 → 厘米（保留 1 位小数） */
export function mToCm(m: number): number {
  return Math.round(m * 1000) / 10
}

/** 保留 1 位小数 */
export function round1(value: number): number {
  return Math.round(value * 10) / 10
}

/** 保留 2 位小数 */
export function round2(value: number): number {
  return Math.round(value * 100) / 100
}

/** 两个日期相差的天数（b - a） */
export function daysBetween(a: string, b: string): number {
  const start = new Date(`${a}T00:00:00`).getTime()
  const end = new Date(`${b}T00:00:00`).getTime()
  if (Number.isNaN(start) || Number.isNaN(end)) return 0
  return Math.round((end - start) / 86400000)
}

/**
 * 生长量年化：把两次检查之间的增量折算成「每年」增量。
 * 天数不足 30 天或日期非法时，退回直接差值，避免出现夸张的年化值。
 */
export function annualGrowth(previous: number, current: number, previousDate: string, currentDate: string): number {
  const delta = current - previous
  const days = daysBetween(previousDate, currentDate)
  if (days < 30) return round2(delta)
  return round2((delta / days) * 365)
}

/**
 * 检查记录的「有效值」：
 * 若该检查已补记复测，则树高 / 胸径 / 冠幅 / 倾斜度 / 空洞数改用复测值，
 * 生长量年化的生效日期也改用复测日期（复测值是在复测当天量取的）；
 * 未复测时原样返回原检查值与原检查日期。
 * 年生长量、倾斜空洞风险、档案列表与养护总览导出统一消费此派生值。
 */
export interface EffectiveSurvey {
  /** 生效日期（复测日期优先，否则为原检查日期） */
  date: string
  heightM: number
  dbhCm: number
  crownM: number
  leanDeg: number
  hollowCount: number
  siteNote: SiteNote
  /** 是否已补记复测 */
  hasRemeasure: boolean
  /** 复测日期（未复测为空字符串） */
  remeasureDate: string
}

export function effectiveSurvey(row: Survey): EffectiveSurvey {
  const remeasured = typeof row.remeasureDate === 'string' && row.remeasureDate !== ''
  const pick = <T>(remeasureVal: T | null, originalVal: T): T =>
    remeasured && remeasureVal !== null ? remeasureVal : originalVal
  return {
    date: remeasured ? row.remeasureDate : row.date,
    heightM: pick(row.remeasureHeightM, row.heightM),
    dbhCm: pick(row.remeasureDbhCm, row.dbhCm),
    crownM: pick(row.remeasureCrownM, row.crownM),
    leanDeg: pick(row.remeasureLeanDeg, row.leanDeg),
    hollowCount: pick(row.remeasureHollowCount, row.hollowCount),
    siteNote: row.siteNote,
    hasRemeasure: remeasured,
    remeasureDate: remeasured ? row.remeasureDate : '',
  }
}

/** 倾斜安全等级 */
export type LeanLevel = 'safe' | 'watch' | 'danger'

/** 倾斜度阈值（度）：< 5 安全，5–10 关注，> 10 危险 */
export const LEAN_WATCH_DEG = 5
export const LEAN_DANGER_DEG = 10

/** 按倾斜角判定安全等级 */
export function leanLevel(leanDeg: number): LeanLevel {
  if (leanDeg > LEAN_DANGER_DEG) return 'danger'
  if (leanDeg >= LEAN_WATCH_DEG) return 'watch'
  return 'safe'
}

/** 倾斜等级中文说明 */
export const LEAN_LEVEL_LABEL: Record<LeanLevel, string> = {
  safe: '倾斜正常',
  watch: '倾斜需关注',
  danger: '倾斜超限',
}

/** 空洞风险提示 */
export function hollowRisk(hollowCount: number): { level: LeanLevel; message: string } {
  if (hollowCount >= 3) {
    return { level: 'danger', message: `发现 ${hollowCount} 处空洞，需立即安排树洞修补并做防腐处理。` }
  }
  if (hollowCount >= 1) {
    return { level: 'watch', message: `发现 ${hollowCount} 处空洞，建议下一年度复壮计划中安排树洞修补。` }
  }
  return { level: 'safe', message: '未见空洞。' }
}

/** 立地状况对应的处置建议 */
export function siteAdvice(siteNote: string): string {
  if (siteNote === '铺装') return '树盘为硬质铺装，建议打透气孔或改造为透气铺装，改善根区通气与水分下渗。'
  if (siteNote === '积水') return '立地存在积水，建议设置排水盲沟并抬高树盘，避免长期沤根。'
  return '立地为裸土，建议覆盖树皮或种植地被，减少水分蒸发与土壤板结。'
}

/** 长势等级排序值（用于取「最新长势」） */
export const VIGOR_ORDER: Record<Vigor, number> = {
  旺盛: 4,
  一般: 3,
  衰弱: 2,
  濒危: 1,
}

/** 取更差的长势等级 */
export function worseVigor(a: Vigor, b: Vigor): Vigor {
  return VIGOR_ORDER[a] <= VIGOR_ORDER[b] ? a : b
}

/**
 * 加固件是否超期未检查。
 * 依据 installDate / lastCheckDate 加上 checkCycleMon 个月，与今天比较。
 */
export function isSupportOverdue(lastCheckDate: string, checkCycleMon: number, reference = today()): boolean {
  const base = lastCheckDate === '' ? '' : lastCheckDate
  if (base === '') return true
  const next = addMonths(base, checkCycleMon)
  return next < reference
}

/** 加固件下次检查日期 */
export function nextCheckDate(lastCheckDate: string, checkCycleMon: number): string {
  if (lastCheckDate === '') return ''
  return addMonths(lastCheckDate, checkCycleMon)
}

/** 超期天数 */
export function overdueDays(lastCheckDate: string, checkCycleMon: number, reference = today()): number {
  const next = nextCheckDate(lastCheckDate, checkCycleMon)
  if (next === '') return 0
  return Math.max(0, daysBetween(next, reference))
}

/** 日期加 n 个月，返回 YYYY-MM-DD */
export function addMonths(date: string, months: number): string {
  const base = new Date(`${date}T00:00:00`)
  if (Number.isNaN(base.getTime())) return ''
  base.setMonth(base.getMonth() + months)
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${base.getFullYear()}-${pad(base.getMonth() + 1)}-${pad(base.getDate())}`
}
