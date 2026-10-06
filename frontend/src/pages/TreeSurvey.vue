<script setup lang="ts">
/**
 * /trees/:id/surveys 树体与立地检查
 * 录树高 / 胸径 / 冠幅 / 倾斜 / 空洞并对比上次，展示古树历史时间线。
 * 每条检查可补记一条复测（不算新到场检查、不挪动原检查日期），
 * 年生长量、倾斜 / 空洞风险与各类导出一律以复测值为准。
 * 消费模型：Survey、Tree；复用组件：<StatBadge>、<EmptyPanel>
 */
import { computed, onMounted, reactive, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage, ElMessageBox, type FormInstance, type FormRules } from 'element-plus'
import EmptyPanel from '@/components/common/EmptyPanel.vue'
import StatBadge from '@/components/common/StatBadge.vue'
import { useIdbTable } from '@/hooks/useIdbTable'
import { HISTORY_KIND_LABEL, useTreeHistory } from '@/hooks/useTreeHistory'
import { useTreeStore } from '@/stores/treeStore'
import { db } from '@/utils/db'
import {
  SITE_NOTE_OPTIONS,
  type SiteNote,
  type RetestDraft,
  type Survey,
  type SurveyDraft,
} from '@/types/survey'
import { today } from '@/utils/id'
import {
  LEAN_DANGER_DEG,
  LEAN_WATCH_DEG,
  annualGrowth,
  hollowRisk,
  isValidRetestDate,
  leanLevel,
  siteAdvice,
  sortSurveyPoints,
  surveyPoint,
  type SurveyPoint,
} from '@/utils/dimension'

const route = useRoute()
const router = useRouter()
const treeStore = useTreeStore()

const treeId = computed<string>(() => String(route.params.id ?? ''))
const tree = computed(() => treeStore.trees.find((item) => item.id === treeId.value) ?? null)
const { rows, loading, create, update, remove } = useIdbTable<Survey>(db.surveys, { sortByUpdatedAt: false })
const { items } = useTreeHistory(treeId)

const dialogVisible = ref(false)
const submitting = ref(false)
const editingId = ref<string | null>(null)
const formRef = ref<FormInstance>()

const form = reactive<SurveyDraft>({
  treeId: '',
  date: '',
  heightM: 12,
  dbhCm: 60,
  crownM: 8,
  leanDeg: 2,
  hollowCount: 0,
  siteNote: '裸土',
})

const rules: FormRules<SurveyDraft> = {
  date: [{ required: true, message: '请选择检查日期', trigger: 'change' }],
  heightM: [{ required: true, message: '请填写树高', trigger: 'blur' }],
  dbhCm: [{ required: true, message: '请填写胸径', trigger: 'blur' }],
  crownM: [{ required: true, message: '请填写冠幅', trigger: 'blur' }],
  leanDeg: [{ required: true, message: '请填写倾斜度', trigger: 'blur' }],
  hollowCount: [{ required: true, message: '请填写空洞数', trigger: 'blur' }],
  siteNote: [{ required: true, message: '请选择立地状况', trigger: 'change' }],
}

/* ------------------------------ 复测弹窗 ------------------------------ */

const retestVisible = ref(false)
const retestSubmitting = ref(false)
/** 当前正在补记 / 编辑复测的检查 */
const retestTarget = ref<Survey | null>(null)
const retestFormRef = ref<FormInstance>()

const retestForm = reactive<RetestDraft>({
  retestDate: '',
  heightM: 12,
  dbhCm: 60,
  crownM: 8,
  leanDeg: 2,
  hollowCount: 0,
})

const retestRules: FormRules<RetestDraft> = {
  retestDate: [
    { required: true, message: '请选择复测日期', trigger: 'change' },
    {
      validator: (_rule, value: string, callback: (error?: Error) => void) => {
        const target = retestTarget.value
        if (target !== null && !isValidRetestDate(target.date, value)) {
          callback(new Error(`复测日期必须晚于原检查日期（${target.date}），且不晚于今天`))
          return
        }
        callback()
      },
      trigger: 'change',
    },
  ],
  heightM: [{ required: true, message: '请填写复测树高', trigger: 'blur' }],
  dbhCm: [{ required: true, message: '请填写复测胸径', trigger: 'blur' }],
  crownM: [{ required: true, message: '请填写复测冠幅', trigger: 'blur' }],
  leanDeg: [{ required: true, message: '请填写复测倾斜度', trigger: 'blur' }],
  hollowCount: [{ required: true, message: '请填写复测空洞数', trigger: 'blur' }],
}

/** 该株古树的到场检查（按日期升序），复测不新增条目 */
const surveys = computed<Survey[]>(() =>
  rows.value
    .filter((row) => row.treeId === treeId.value)
    .sort((a, b) => a.date.localeCompare(b.date) || a.createdAt.localeCompare(b.createdAt))
)

/** 生效测量点（有复测取复测值，日期仍为原检查日期），按日期升序 */
const points = computed<SurveyPoint[]>(() => sortSurveyPoints(surveys.value))

/** 表格展示顺序：日期倒序；行数据保留原检查，便于操作与复测展示 */
const displayRows = computed<Survey[]>(() => [...surveys.value].reverse())

const pointBySurveyId = computed<Map<string, SurveyPoint>>(() => {
  const map = new Map<string, SurveyPoint>()
  points.value.forEach((point) => map.set(point.surveyId, point))
  return map
})

function pointOf(row: Survey): SurveyPoint {
  return pointBySurveyId.value.get(row.id) ?? surveyPoint(row)
}

function previousPointOf(row: Survey): SurveyPoint | null {
  const index = points.value.findIndex((point) => point.surveyId === row.id)
  return index > 0 ? points.value[index - 1] : null
}

function deltaText(previous: number | null, current: number, unit: string): string {
  if (previous === null) return '首次检查'
  const delta = Math.round((current - previous) * 100) / 100
  if (delta === 0) return `持平 ${unit}`
  return `${delta > 0 ? '+' : ''}${delta} ${unit}`
}

const latest = computed<SurveyPoint | null>(() =>
  points.value.length === 0 ? null : points.value[points.value.length - 1]
)

const retestCount = computed<number>(() => points.value.filter((point) => point.retested).length)

const annual = computed(() => {
  if (points.value.length < 2) return { height: 0, dbh: 0, crown: 0 }
  const current = points.value[points.value.length - 1]
  const previous = points.value[points.value.length - 2]
  return {
    height: annualGrowth(previous.heightM, current.heightM, previous.date, current.date),
    dbh: annualGrowth(previous.dbhCm, current.dbhCm, previous.date, current.date),
    crown: annualGrowth(previous.crownM, current.crownM, previous.date, current.date),
  }
})

const risk = computed(() => (latest.value === null ? null : hollowRisk(latest.value.hollowCount)))

onMounted(() => {
  void treeStore.loadAll()
})

function openCreate(): void {
  editingId.value = null
  Object.assign(form, {
    treeId: treeId.value,
    date: new Date().toISOString().slice(0, 10),
    heightM: latest.value === null ? 12 : latest.value.heightM,
    dbhCm: latest.value === null ? 60 : latest.value.dbhCm,
    crownM: latest.value === null ? 8 : latest.value.crownM,
    leanDeg: latest.value === null ? 2 : latest.value.leanDeg,
    hollowCount: latest.value === null ? 0 : latest.value.hollowCount,
    siteNote: latest.value === null ? ('裸土' as SiteNote) : latest.value.siteNote,
  })
  dialogVisible.value = true
}

function openEdit(row: Survey): void {
  editingId.value = row.id
  Object.assign(form, {
    treeId: row.treeId,
    date: row.date,
    heightM: row.heightM,
    dbhCm: row.dbhCm,
    crownM: row.crownM,
    leanDeg: row.leanDeg,
    hollowCount: row.hollowCount,
    siteNote: row.siteNote,
  })
  dialogVisible.value = true
}

async function handleSubmit(): Promise<void> {
  if (formRef.value === undefined) return
  const valid = await formRef.value.validate().catch(() => false)
  if (!valid) return
  submitting.value = true
  try {
    if (editingId.value === null) {
      // 新到场检查默认无复测
      await create({ ...form, retest: null }, 'survey')
      ElMessage.success('树体检查记录已登记')
    } else {
      // 编辑只改原检查本身，复测保留并继续以复测值生效
      await update(editingId.value, { ...form })
      ElMessage.success('检查记录已更新')
    }
    if (leanLevel(form.leanDeg) === 'danger') {
      ElMessage({
        type: 'warning',
        message: `倾斜度 ${form.leanDeg}° 超过 ${LEAN_DANGER_DEG}° 警戒线，建议安排支撑加固`,
        duration: 6000,
      })
    }
    dialogVisible.value = false
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '保存失败')
  } finally {
    submitting.value = false
  }
}

async function handleDelete(row: Survey): Promise<void> {
  try {
    await ElMessageBox.confirm(
      !row.retest
        ? `确认删除 ${row.date} 的检查记录？`
        : `确认删除 ${row.date} 的检查记录（含 ${row.retest.retestDate} 的复测）？`,
      '删除确认',
      {
        type: 'warning',
        confirmButtonText: '删除',
        cancelButtonText: '取消',
      }
    )
  } catch {
    return
  }
  await remove(row.id)
  ElMessage.success('检查记录已删除')
}

/* ------------------------------ 复测增改撤 ------------------------------ */

function openRetest(row: Survey): void {
  retestTarget.value = row
  const existing = row.retest
  Object.assign(retestForm, {
    retestDate: existing?.retestDate ?? today(),
    heightM: existing?.heightM ?? row.heightM,
    dbhCm: existing?.dbhCm ?? row.dbhCm,
    crownM: existing?.crownM ?? row.crownM,
    leanDeg: existing?.leanDeg ?? row.leanDeg,
    hollowCount: existing?.hollowCount ?? row.hollowCount,
  })
  retestVisible.value = true
  // 弹窗打开后清掉上一次的校验状态
  void Promise.resolve().then(() => retestFormRef.value?.clearValidate())
}

/** 复测日期选择器禁用：不晚于今天，且不早于/等于原检查日期 */
function retestDateDisabled(date: Date): boolean {
  const target = retestTarget.value
  if (target === null) return false
  const todayMs = Number(new Date(`${today()}T00:00:00`))
  if (date.getTime() > todayMs) return true
  return date.getTime() <= Number(new Date(`${target.date}T00:00:00`))
}

async function handleRetestSubmit(): Promise<void> {
  if (retestFormRef.value === undefined || retestTarget.value === null) return
  const valid = await retestFormRef.value.validate().catch(() => false)
  if (!valid) return
  if (!isValidRetestDate(retestTarget.value.date, retestForm.retestDate)) {
    ElMessage.error(`复测日期必须晚于原检查日期（${retestTarget.value.date}），且不晚于今天`)
    return
  }
  retestSubmitting.value = true
  try {
    await update(retestTarget.value.id, {
      retest: { ...retestForm },
    })
    ElMessage.success(`复测已保存：${retestTarget.value.date} 检查的各项数值改按复测值统计`)
    retestVisible.value = false
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '保存失败')
  } finally {
    retestSubmitting.value = false
  }
}

async function handleRetestRevoke(): Promise<void> {
  if (retestTarget.value === null || !retestTarget.value.retest) return
  const target = retestTarget.value
  try {
    await ElMessageBox.confirm(
      `撤销后 ${target.date} 的检查将恢复采用首测数值，年生长量与倾斜 / 空洞风险也随之改回首测值。`,
      '确认撤销该次复测？',
      { type: 'warning', confirmButtonText: '撤销复测', cancelButtonText: '取消', confirmButtonClass: 'el-button--danger' }
    )
  } catch {
    return
  }
  await update(target.id, { retest: null })
  ElMessage.success('复测已撤销，恢复采用首测值')
  retestVisible.value = false
}
</script>

<template>
  <div>
    <el-page-header :content="tree === null ? '树体检查' : `${tree.code} · ${tree.species}`" @back="router.push('/trees')">
      <template #extra>
        <el-space>
          <el-tag v-if="tree" :type="tree.protectLevel === '一级' ? 'danger' : tree.protectLevel === '二级' ? 'warning' : 'info'">
            {{ tree.protectLevel }}
          </el-tag>
          <el-tag v-if="tree" type="info">约 {{ tree.ageYears }} 年</el-tag>
        </el-space>
      </template>
    </el-page-header>

    <EmptyPanel
      v-if="treeStore.ready && tree === null"
      title="古树档案不存在或已被删除"
      :description="`未能找到 id 为「${treeId}」的古树档案，可能是链接已过期，或该档案已被删除。`"
      action-text="返回古树档案列表"
      class="mt-14"
      @action="router.push('/trees')"
    >
      <template #extra>
        <el-button @click="router.push('/trees')">返回</el-button>
      </template>
    </EmptyPanel>

    <template v-else>
      <div class="stat-row">
        <StatBadge
          label="到场检查次数"
          :value="surveys.length"
          suffix="次"
          tone="primary"
          icon="Histogram"
          :hint="retestCount > 0 ? `到场检查 ${surveys.length} 次；另有 ${retestCount} 条补记复测（不计数，数值以复测为准）` : '补记复测不算新到场检查，不计入次数'"
        />
        <StatBadge
          label="补记复测"
          :value="retestCount"
          suffix="条"
          :tone="retestCount > 0 ? 'warning' : 'default'"
          icon="DataLine"
          hint="复测用于更正首测数值，不改原检查日期"
        />
        <StatBadge
          label="最新树高"
          :value="latest === null ? '—' : latest.heightM"
          suffix="m"
          tone="info"
          icon="DataLine"
        />
        <StatBadge
          label="最新胸径"
          :value="latest === null ? '—' : latest.dbhCm"
          suffix="cm"
          tone="success"
          icon="TrendCharts"
        />
        <StatBadge
          label="树高年生长量"
          :value="annual.height"
          suffix="m/年"
          tone="primary"
          icon="TrendCharts"
          hint="由最近两次检查（复测值）的树高差按原检查日期年化"
        />
        <StatBadge
          label="胸径年生长量"
          :value="annual.dbh"
          suffix="cm/年"
          tone="success"
          icon="TrendCharts"
        />
        <StatBadge
          label="空洞风险"
          :value="latest === null ? '—' : latest.hollowCount"
          suffix="处"
          :tone="risk === null ? 'default' : risk.level === 'danger' ? 'danger' : risk.level === 'watch' ? 'warning' : 'success'"
          icon="Warning"
          :hint="risk === null ? '暂无检查记录' : risk.message"
        />
      </div>

      <el-alert
        v-if="retestCount > 0"
        type="info"
        show-icon
        :closable="false"
        class="mb-14"
        title="本树已有补记复测：复测只是对原检查的测量更正，不算新到场检查，检查次数不增加、日期不挪动；年生长量、倾斜 / 空洞风险与养护总览导出均以复测值为准。"
      />
      <el-alert
        v-if="risk !== null && risk.level !== 'safe'"
        :type="risk.level === 'danger' ? 'error' : 'warning'"
        show-icon
        :closable="false"
        class="mb-14"
        :title="risk.message"
        :description="latest === null ? '' : siteAdvice(latest.siteNote)"
      />
      <el-alert
        v-else-if="latest !== null && leanLevel(latest.leanDeg) !== 'safe'"
        :type="leanLevel(latest.leanDeg) === 'danger' ? 'error' : 'warning'"
        show-icon
        :closable="false"
        class="mb-14"
        :title="`倾斜度 ${latest.leanDeg}°，超过 ${leanLevel(latest.leanDeg) === 'danger' ? LEAN_DANGER_DEG : LEAN_WATCH_DEG}° 阈值`"
        :description="siteAdvice(latest.siteNote)"
      />

      <el-row :gutter="14">
        <el-col :xs="24" :lg="16">
          <el-card shadow="never">
            <template #header>
              <div class="card-header">
                <span class="card-header__title">树体与立地检查记录</span>
                <el-button type="primary" @click="openCreate">
                  <el-icon><Plus /></el-icon>
                  <span>新增检查</span>
                </el-button>
              </div>
            </template>

            <EmptyPanel
              v-if="surveys.length === 0 && !loading"
              title="该古树还没有检查记录"
              description="录入树高、胸径、冠幅、倾斜度、空洞数与立地状况，系统会自动与上次检查对比并计算年生长量。"
              action-text="新增第一次检查"
              @action="openCreate"
            />

            <el-table v-else v-loading="loading" :data="displayRows" row-key="id" stripe>
              <el-table-column label="检查日期" width="150">
                <template #default="{ row }">
                  <div class="cell-stack">
                    <span>{{ row.date }}</span>
                    <el-tag
                      v-if="row.retest"
                      size="small"
                      type="warning"
                      effect="plain"
                      class="cell-retest-tag"
                    >
                      复测 {{ row.retest.retestDate }}
                    </el-tag>
                    <span v-else class="cell-sub">到场检查</span>
                  </div>
                </template>
              </el-table-column>
              <el-table-column label="树高(m)" width="150">
                <template #default="{ row }">
                  <div class="cell-stack">
                    <span>
                      {{ pointOf(row).heightM }}
                      <el-tag v-if="pointOf(row).retested" size="small" type="warning" effect="plain">复测值</el-tag>
                    </span>
                    <span v-if="pointOf(row).retested" class="cell-retest-old">原测 {{ row.heightM }}</span>
                    <span class="cell-sub">{{ deltaText(previousPointOf(row)?.heightM ?? null, pointOf(row).heightM, 'm') }}</span>
                  </div>
                </template>
              </el-table-column>
              <el-table-column label="胸径(cm)" width="150">
                <template #default="{ row }">
                  <div class="cell-stack">
                    <span>
                      {{ pointOf(row).dbhCm }}
                      <el-tag v-if="pointOf(row).retested" size="small" type="warning" effect="plain">复测值</el-tag>
                    </span>
                    <span v-if="pointOf(row).retested" class="cell-retest-old">原测 {{ row.dbhCm }}</span>
                    <span class="cell-sub">{{ deltaText(previousPointOf(row)?.dbhCm ?? null, pointOf(row).dbhCm, 'cm') }}</span>
                  </div>
                </template>
              </el-table-column>
              <el-table-column label="冠幅(m)" width="140">
                <template #default="{ row }">
                  <div class="cell-stack">
                    <span>
                      {{ pointOf(row).crownM }}
                      <el-tag v-if="pointOf(row).retested" size="small" type="warning" effect="plain">复测值</el-tag>
                    </span>
                    <span v-if="pointOf(row).retested" class="cell-retest-old">原测 {{ row.crownM }}</span>
                    <span class="cell-sub">{{ deltaText(previousPointOf(row)?.crownM ?? null, pointOf(row).crownM, 'm') }}</span>
                  </div>
                </template>
              </el-table-column>
              <el-table-column label="倾斜度" width="140">
                <template #default="{ row }">
                  <el-tag
                    size="small"
                    :type="leanLevel(pointOf(row).leanDeg) === 'danger' ? 'danger' : leanLevel(pointOf(row).leanDeg) === 'watch' ? 'warning' : 'success'"
                  >
                    {{ pointOf(row).leanDeg }}°
                  </el-tag>
                  <span v-if="pointOf(row).retested" class="cell-retest-old">原测 {{ row.leanDeg }}°</span>
                </template>
              </el-table-column>
              <el-table-column label="空洞" width="110" align="right">
                <template #default="{ row }">
                  <div class="cell-stack">
                    <span>{{ pointOf(row).hollowCount }} 处</span>
                    <span v-if="pointOf(row).retested" class="cell-retest-old">原测 {{ row.hollowCount }} 处</span>
                  </div>
                </template>
              </el-table-column>
              <el-table-column label="立地状况" width="100">
                <template #default="{ row }">
                  <el-tag size="small" type="info">{{ row.siteNote }}</el-tag>
                </template>
              </el-table-column>
              <el-table-column label="操作" width="210" fixed="right">
                <template #default="{ row }">
                  <el-button
                    :type="!row.retest ? 'warning' : 'primary'"
                    link
                    size="small"
                    @click="openRetest(row)"
                  >
                    {{ !row.retest ? '补记复测' : '改/撤复测' }}
                  </el-button>
                  <el-button link type="primary" size="small" @click="openEdit(row)">编辑</el-button>
                  <el-button link type="danger" size="small" @click="handleDelete(row)">删除</el-button>
                </template>
              </el-table-column>
            </el-table>
          </el-card>
        </el-col>

        <el-col :xs="24" :lg="8">
          <el-card shadow="never">
            <template #header>
              <span class="card-header__title">古树历史时间线</span>
            </template>
            <el-timeline v-if="items.length > 0">
              <el-timeline-item
                v-for="item in items"
                :key="item.key"
                :timestamp="`${item.date} · ${HISTORY_KIND_LABEL[item.kind]}`"
                placement="top"
              >
                <div class="timeline-title">{{ item.title }}</div>
                <div class="timeline-detail">{{ item.detail }}</div>
                <el-tag size="small" effect="plain">{{ item.badge }}</el-tag>
              </el-timeline-item>
            </el-timeline>
            <el-empty v-else description="暂无历史记录" />
          </el-card>
        </el-col>
      </el-row>
    </template>

    <el-dialog v-model="dialogVisible" :title="editingId === null ? '新增树体检查' : '编辑树体检查'" width="660px">
      <el-form ref="formRef" :model="form" :rules="rules" label-width="110px">
        <el-row :gutter="12">
          <el-col :span="12">
            <el-form-item label="检查日期" prop="date">
              <el-date-picker v-model="form.date" type="date" value-format="YYYY-MM-DD" style="width: 100%" />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="立地状况" prop="siteNote">
              <el-select v-model="form.siteNote" style="width: 100%">
                <el-option v-for="item in SITE_NOTE_OPTIONS" :key="item" :value="item" :label="item" />
              </el-select>
            </el-form-item>
          </el-col>
        </el-row>
        <el-row :gutter="12">
          <el-col :span="8">
            <el-form-item label="树高（m）" prop="heightM">
              <el-input-number v-model="form.heightM" :min="0.1" :max="120" :step="0.1" :precision="2" style="width: 100%" />
            </el-form-item>
          </el-col>
          <el-col :span="8">
            <el-form-item label="胸径（cm）" prop="dbhCm">
              <el-input-number v-model="form.dbhCm" :min="1" :max="600" :step="0.5" :precision="2" style="width: 100%" />
            </el-form-item>
          </el-col>
          <el-col :span="8">
            <el-form-item label="冠幅（m）" prop="crownM">
              <el-input-number v-model="form.crownM" :min="0.1" :max="80" :step="0.1" :precision="2" style="width: 100%" />
            </el-form-item>
          </el-col>
        </el-row>
        <el-row :gutter="12">
          <el-col :span="12">
            <el-form-item label="倾斜度（°）" prop="leanDeg">
              <el-input-number v-model="form.leanDeg" :min="0" :max="90" :step="0.1" :precision="2" style="width: 100%" />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="空洞数（处）" prop="hollowCount">
              <el-input-number v-model="form.hollowCount" :min="0" :max="99" :step="1" style="width: 100%" />
            </el-form-item>
          </el-col>
        </el-row>
        <el-alert
          :type="leanLevel(form.leanDeg) === 'danger' ? 'error' : leanLevel(form.leanDeg) === 'watch' ? 'warning' : 'success'"
          show-icon
          :closable="false"
          :title="`当前倾斜度判定：${leanLevel(form.leanDeg) === 'danger' ? '超限' : leanLevel(form.leanDeg) === 'watch' ? '需关注' : '正常'}`"
          :description="`安全阈值：< ${LEAN_WATCH_DEG}° 正常；${LEAN_WATCH_DEG}–${LEAN_DANGER_DEG}° 需关注；> ${LEAN_DANGER_DEG}° 超限。${siteAdvice(form.siteNote)}`"
        />
      </el-form>
      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="submitting" @click="handleSubmit">保存</el-button>
      </template>
    </el-dialog>

    <el-dialog
      v-model="retestVisible"
      :title="!retestTarget?.retest ? `补记复测 · ${retestTarget?.date ?? ''} 检查` : `编辑复测 · 原检查 ${retestTarget?.date ?? ''}`"
      width="660px"
    >
      <el-alert
        type="warning"
        show-icon
        :closable="false"
        class="mb-14"
        title="复测是对当场检查的测量更正：不算一次新到场检查（检查次数不增加），生长量时间轴仍用原检查日期；保存后该株树的年生长量、倾斜 / 空洞风险、档案列表与养护总览导出均改用复测值。"
      />
      <el-form ref="retestFormRef" :model="retestForm" :rules="retestRules" label-width="110px">
        <el-row :gutter="12">
          <el-col :span="12">
            <el-form-item label="原检查日期">
              <el-input :model-value="retestTarget?.date ?? ''" disabled />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="复测日期" prop="retestDate">
              <el-date-picker
                v-model="retestForm.retestDate"
                type="date"
                value-format="YYYY-MM-DD"
                placeholder="晚于原检查、不晚于今天"
                style="width: 100%"
                :disabled-date="retestDateDisabled"
              />
            </el-form-item>
          </el-col>
        </el-row>
        <el-row :gutter="12">
          <el-col :span="8">
            <el-form-item label="复测树高（m）" prop="heightM">
              <el-input-number v-model="retestForm.heightM" :min="0.1" :max="120" :step="0.1" :precision="2" style="width: 100%" />
            </el-form-item>
          </el-col>
          <el-col :span="8">
            <el-form-item label="复测胸径（cm）" prop="dbhCm">
              <el-input-number v-model="retestForm.dbhCm" :min="1" :max="600" :step="0.5" :precision="2" style="width: 100%" />
            </el-form-item>
          </el-col>
          <el-col :span="8">
            <el-form-item label="复测冠幅（m）" prop="crownM">
              <el-input-number v-model="retestForm.crownM" :min="0.1" :max="80" :step="0.1" :precision="2" style="width: 100%" />
            </el-form-item>
          </el-col>
        </el-row>
        <el-row :gutter="12">
          <el-col :span="12">
            <el-form-item label="复测倾斜度（°）" prop="leanDeg">
              <el-input-number v-model="retestForm.leanDeg" :min="0" :max="90" :step="0.1" :precision="2" style="width: 100%" />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="复测空洞数（处）" prop="hollowCount">
              <el-input-number v-model="retestForm.hollowCount" :min="0" :max="99" :step="1" style="width: 100%" />
            </el-form-item>
          </el-col>
        </el-row>
        <el-alert
          :type="leanLevel(retestForm.leanDeg) === 'danger' ? 'error' : leanLevel(retestForm.leanDeg) === 'watch' ? 'warning' : 'success'"
          show-icon
          :closable="false"
          :title="`复测倾斜度判定：${leanLevel(retestForm.leanDeg) === 'danger' ? '超限' : leanLevel(retestForm.leanDeg) === 'watch' ? '需关注' : '正常'}`"
          :description="`安全阈值：< ${LEAN_WATCH_DEG}° 正常；${LEAN_WATCH_DEG}–${LEAN_DANGER_DEG}° 需关注；> ${LEAN_DANGER_DEG}° 超限。立地状况沿用原检查记录。`"
        />
      </el-form>
      <template #footer>
        <el-button
          v-if="retestTarget?.retest"
          type="danger"
          plain
          @click="handleRetestRevoke"
        >
          撤销复测
        </el-button>
        <el-button @click="retestVisible = false">取消</el-button>
        <el-button type="primary" :loading="retestSubmitting" @click="handleRetestSubmit">保存复测</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.stat-row {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  margin: 14px 0;
}

.card-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
}

.card-header__title {
  font-size: 15px;
  font-weight: 600;
  color: #2f2a24;
}

.cell-stack {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.cell-sub {
  font-size: 12px;
  color: #8c8479;
}

.cell-retest-old {
  font-size: 12px;
  color: #b08a4a;
  text-decoration: line-through;
}

.cell-retest-tag {
  width: fit-content;
}

.timeline-title {
  font-size: 13px;
  font-weight: 600;
  color: #2f2a24;
}

.timeline-detail {
  margin: 4px 0 6px;
  font-size: 12px;
  line-height: 1.7;
  color: #8c8479;
}

.mt-14 {
  margin-top: 14px;
}

.mb-14 {
  margin-bottom: 14px;
}
</style>
