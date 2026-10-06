/**
 * 树体检查（Survey）
 * 每次到场检查记录树高、胸径、冠幅、倾斜度、空洞数与立地状况。
 * 首次测量不准时，可对该次检查「补记一条复测」（SurveyRetest）更正数值：
 * 复测不算新到场检查、不挪动原检查日期，后续统计一律以复测值为准。
 */

/** 立地状况：铺装 / 裸土 / 积水 */
export type SiteNote = '铺装' | '裸土' | '积水'

export const SITE_NOTE_OPTIONS: SiteNote[] = ['铺装', '裸土', '积水']

/**
 * 补记复测：对某次到场检查的测量更正。
 * 复测不是一次新到场检查，因此不含立地状况，也不参与检查次数统计；
 * retestDate 仅记录复测发生日期，生长量时间轴仍沿用原检查日期。
 */
export interface SurveyRetest {
  /** 复测日期 YYYY-MM-DD（必须严格晚于原检查日期，且不晚于复测登记当天） */
  retestDate: string
  /** 复测树高（米） */
  heightM: number
  /** 复测胸径（厘米） */
  dbhCm: number
  /** 复测冠幅（米） */
  crownM: number
  /** 复测倾斜度（度） */
  leanDeg: number
  /** 复测空洞数（个） */
  hollowCount: number
}

export interface Survey {
  id: string
  /** 所属古树 */
  treeId: string
  /** 检查日期 YYYY-MM-DD */
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
  /** 补记复测（每条检查至多一条；为 null 表示未复测，全部采用原测值） */
  retest: SurveyRetest | null
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

/** 补记 / 编辑复测的表单草稿 */
export interface RetestDraft {
  retestDate: string
  heightM: number
  dbhCm: number
  crownM: number
  leanDeg: number
  hollowCount: number
}
