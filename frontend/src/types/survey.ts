/**
 * 树体检查（Survey）
 * 每次检查记录树高、胸径、冠幅、倾斜度、空洞数与立地状况。
 */

/** 立地状况：铺装 / 裸土 / 积水 */
export type SiteNote = '铺装' | '裸土' | '积水'

export const SITE_NOTE_OPTIONS: SiteNote[] = ['铺装', '裸土', '积水']

export interface Survey {
  id: string
  /** 所属古树 */
  treeId: string
  /** 检查日期 YYYY-MM-DD（到场检查日期，复测不改写该字段） */
  date: string
  /** 树高（米） */
  heightM: number
  /** 胸径（厘米） */
  dbhCm: number
  /** 冠幅（米） */
  crownM: number
  /** 倾斜度（度） */
  leanDeg: number
  /** 空洞数（个） */
  hollowCount: number
  /** 立地状况 */
  siteNote: SiteNote
  /** 复测日期 YYYY-MM-DD；空字符串表示尚未复测 */
  remeasureDate: string
  /** 复测树高（米） */
  remeasureHeightM: number | null
  /** 复测胸径（厘米） */
  remeasureDbhCm: number | null
  /** 复测冠幅（米） */
  remeasureCrownM: number | null
  /** 复测倾斜度（度） */
  remeasureLeanDeg: number | null
  /** 复测空洞数（个） */
  remeasureHollowCount: number | null
  createdAt: string
  updatedAt: string
  revision: number
}

/** 新建 / 编辑树体检查的表单草稿 */
export interface SurveyDraft {
  treeId: string
  date: string
  heightM: number
  dbhCm: number
  crownM: number
  leanDeg: number
  hollowCount: number
  siteNote: SiteNote
}

/** 补记复测的表单草稿 */
export interface RemeasureDraft {
  /** 复测日期 YYYY-MM-DD */
  remeasureDate: string
  /** 复测树高（米） */
  remeasureHeightM: number
  /** 复测胸径（厘米） */
  remeasureDbhCm: number
  /** 复测冠幅（米） */
  remeasureCrownM: number
  /** 复测倾斜度（度） */
  remeasureLeanDeg: number
  /** 复测空洞数（个） */
  remeasureHollowCount: number
}

/** 判断该检查是否已补记复测 */
export function hasRemeasure(row: Survey): boolean {
  return typeof row.remeasureDate === 'string' && row.remeasureDate !== ''
}

/** 构造一份空的复测表单草稿（数值默认取原检查值） */
export function defaultRemeasureDraft(row: Survey): RemeasureDraft {
  return {
    remeasureDate: '',
    remeasureHeightM: row.heightM,
    remeasureDbhCm: row.dbhCm,
    remeasureCrownM: row.crownM,
    remeasureLeanDeg: row.leanDeg,
    remeasureHollowCount: row.hollowCount,
  }
}
