<script setup lang="ts">
import { useIntervalFn } from '@vueuse/core'
import { storeToRefs } from 'pinia'
import { computed, onMounted, ref, watch } from 'vue'
import { useAccountStore } from '@/stores/account'
import { useBagStore } from '@/stores/bag'
import { useSettingStore } from '@/stores/setting'
import { useStatusStore } from '@/stores/status'
import { useToastStore } from '@/stores/toast'

const accountStore = useAccountStore()
const bagStore = useBagStore()
const settingStore = useSettingStore()
const statusStore = useStatusStore()
const toast = useToastStore()
const { currentAccountId, currentAccount } = storeToRefs(accountStore)
const { items, dashboardItems, mallGoods, sellPreview, loading: bagLoading, mallLoading, sellPreviewLoading, actionLoading } = storeToRefs(bagStore)
const { settings } = storeToRefs(settingStore)
const { status, loading: statusLoading, error: statusError, realtimeConnected } = storeToRefs(statusStore)

const imageErrors = ref<Record<string | number, boolean>>({})
const selectedItemIds = ref<number[]>([])
const purchaseCounts = ref<Record<number, number>>({})
const activeTab = ref<'bag' | 'sell' | 'mall'>('bag')
const respectPolicyForSelected = ref(true)

const sellableIds = computed(() => new Set(
  items.value
    .filter((it: any) => it?.category === 'fruit')
    .map((it: any) => Number(it.id || 0))
    .filter((id: number) => id > 0),
))

const selectedSellItems = computed(() => {
  const selected = new Set(selectedItemIds.value)
  return items.value.filter((item: any) => selected.has(Number(item.id || 0)) && sellableIds.value.has(Number(item.id || 0)))
})

const sellConfigSummary = computed(() => {
  const sell = settings.value.tradeConfig?.sell || {}
  const rareKeep = sell.rareKeep || {}
  return {
    keepMinEachFruit: Number(sell.keepMinEachFruit || 0),
    keepFruitIds: Array.isArray(sell.keepFruitIds) ? sell.keepFruitIds : [],
    rareKeepEnabled: !!rareKeep.enabled,
    judgeBy: rareKeep.judgeBy || 'either',
    minPlantLevel: Number(rareKeep.minPlantLevel || 0),
    minUnitPrice: Number(rareKeep.minUnitPrice || 0),
    previewBeforeManualSell: !!sell.previewBeforeManualSell,
  }
})

function pruneSelectedItems() {
  const allowed = sellableIds.value
  selectedItemIds.value = selectedItemIds.value.filter(id => allowed.has(Number(id)))
}

function toggleSelectItem(itemId: number) {
  if (!sellableIds.value.has(itemId))
    return
  if (selectedItemIds.value.includes(itemId)) {
    selectedItemIds.value = selectedItemIds.value.filter(id => id !== itemId)
  }
  else {
    selectedItemIds.value = [...selectedItemIds.value, itemId]
  }
}

function selectAllSellable() {
  selectedItemIds.value = items.value
    .filter((item: any) => sellableIds.value.has(Number(item.id || 0)))
    .map((item: any) => Number(item.id || 0))
}

function clearSelection() {
  selectedItemIds.value = []
}

async function ensureConnected() {
  if (!currentAccountId.value)
    return false
  if (!realtimeConnected.value) {
    await statusStore.fetchStatus(currentAccountId.value)
  }
  return !!(currentAccount.value?.running && status.value?.connection?.connected)
}

async function loadBag() {
  if (!currentAccountId.value)
    return
  const connected = await ensureConnected()
  if (!connected) {
    imageErrors.value = {}
    clearSelection()
    return
  }
  await Promise.all([
    settingStore.fetchSettings(currentAccountId.value),
    bagStore.fetchBag(currentAccountId.value),
    bagStore.fetchSellPreview(currentAccountId.value),
    bagStore.fetchMallGoods(currentAccountId.value),
  ])
  imageErrors.value = {}
  pruneSelectedItems()
}

async function handleRefresh() {
  await loadBag()
  toast.success('背包和商城数据已刷新')
}

async function handlePreviewSell() {
  if (!currentAccountId.value)
    return
  await bagStore.fetchSellPreview(currentAccountId.value)
  activeTab.value = 'sell'
  toast.success('已刷新出售预览')
}

async function handleSellByPolicy() {
  if (!currentAccountId.value)
    return
  if (sellConfigSummary.value.previewBeforeManualSell) {
    await bagStore.fetchSellPreview(currentAccountId.value)
  }
  const result = await bagStore.sellByPolicy(currentAccountId.value)
  if (result) {
    activeTab.value = 'sell'
    toast.success(result.message || '已按策略出售')
    clearSelection()
  }
}

async function handleSellSelected() {
  if (!currentAccountId.value || selectedItemIds.value.length === 0)
    return
  if (sellConfigSummary.value.previewBeforeManualSell) {
    await bagStore.fetchSellPreview(currentAccountId.value)
  }
  const result = await bagStore.sellSelected(currentAccountId.value, selectedItemIds.value, respectPolicyForSelected.value)
  if (result) {
    activeTab.value = 'sell'
    toast.success(result.message || '已出售选中果实')
    clearSelection()
  }
}

function getPurchaseCount(goodsId: number) {
  return Math.max(1, Number(purchaseCounts.value[goodsId] || 1))
}

function updatePurchaseCount(goodsId: number, value: number) {
  purchaseCounts.value = {
    ...purchaseCounts.value,
    [goodsId]: Math.max(1, Number(value || 1)),
  }
}

async function handleBuyGoods(goods: any) {
  if (!currentAccountId.value)
    return
  const goodsId = Number(goods?.goodsId || 0)
  if (!goodsId)
    return
  const result = await bagStore.buyMallGoods(currentAccountId.value, goodsId, getPurchaseCount(goodsId))
  if (result) {
    toast.success(`已购买 ${goods?.name || `商品#${goodsId}`}`)
  }
}

function isSelected(itemId: number) {
  return selectedItemIds.value.includes(itemId)
}

function formatPreviewReason(item: any) {
  if (!item?.keepReasons?.length)
    return ''
  return item.keepReasons.join(' / ')
}

onMounted(() => {
  loadBag()
})

watch(currentAccountId, () => {
  clearSelection()
  loadBag()
})

watch(items, () => {
  pruneSelectedItems()
})

useIntervalFn(loadBag, 60000)
</script>

<template>
  <div class="space-y-4">
    <div class="mb-4 flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-center">
      <div>
        <h2 class="flex items-center gap-2 text-2xl font-bold">
          <div class="i-carbon-inventory-management" />
          背包与交易
        </h2>
        <div class="mt-1 text-sm text-gray-500">
          背包 {{ items.length }} 种物品
          <span v-if="selectedSellItems.length"> · 已选 {{ selectedSellItems.length }} 种果实</span>
        </div>
      </div>

      <div class="flex flex-wrap items-center gap-2">
        <button class="trade-btn trade-btn-secondary" :disabled="actionLoading" @click="handleRefresh">
          刷新
        </button>
        <button class="trade-btn trade-btn-secondary" :disabled="sellPreviewLoading || actionLoading" @click="handlePreviewSell">
          刷新出售预览
        </button>
        <button class="trade-btn trade-btn-primary" :disabled="actionLoading" @click="handleSellByPolicy">
          按策略出售
        </button>
      </div>
    </div>

    <div class="grid gap-3 lg:grid-cols-3">
      <div class="glass-panel rounded-xl p-4 shadow">
        <div class="text-xs text-gray-400 uppercase tracking-[0.2em]">
          交易策略
        </div>
        <div class="mt-2 text-sm font-medium">
          每种果实保留 {{ sellConfigSummary.keepMinEachFruit }} 个
        </div>
        <div class="mt-1 text-xs text-gray-500">
          白名单 {{ sellConfigSummary.keepFruitIds.length }} 项
          <span v-if="sellConfigSummary.rareKeepEnabled">
            · 稀有保留开启
          </span>
          <span v-if="sellConfigSummary.previewBeforeManualSell">
            · 手动出售前强制预览
          </span>
        </div>
        <div class="mt-2 text-xs text-amber-500/90">
          当前仅支持出售果实，种子、化肥、狗粮、礼包等物品不会出现在出售勾选中。
        </div>
      </div>

      <div class="glass-panel rounded-xl p-4 shadow">
        <div class="text-xs text-gray-400 uppercase tracking-[0.2em]">
          预计出售
        </div>
        <div class="mt-2 text-sm font-medium">
          {{ sellPreview?.totalSellCount || 0 }} 个果实
        </div>
        <div class="mt-1 text-xs text-gray-500">
          {{ sellPreview?.totalSellKinds || 0 }} 种 · 预计 {{ sellPreview?.expectedGold || 0 }} 金币
        </div>
      </div>

      <div class="glass-panel rounded-xl p-4 shadow">
        <div class="text-xs text-gray-400 uppercase tracking-[0.2em]">
          快速选择
        </div>
        <div class="mt-3 flex flex-wrap gap-2">
          <button class="trade-btn trade-btn-secondary" @click="selectAllSellable">
            全选可售果实
          </button>
          <button class="trade-btn trade-btn-secondary" @click="clearSelection">
            清空选择
          </button>
          <label class="inline-flex items-center gap-2 text-sm text-gray-500">
            <input v-model="respectPolicyForSelected" type="checkbox">
            选中出售也遵守保留策略
          </label>
        </div>
      </div>
    </div>

    <div class="flex flex-wrap gap-2">
      <button class="trade-tab" :class="{ active: activeTab === 'bag' }" @click="activeTab = 'bag'">
        背包
      </button>
      <button class="trade-tab" :class="{ active: activeTab === 'sell' }" @click="activeTab = 'sell'">
        出售预览
      </button>
      <button class="trade-tab" :class="{ active: activeTab === 'mall' }" @click="activeTab = 'mall'">
        商城
      </button>
    </div>

    <div v-if="bagLoading || statusLoading" class="flex justify-center py-12">
      <div class="i-svg-spinners-90-ring-with-bg text-4xl text-blue-500" />
    </div>

    <div v-else-if="!currentAccountId" class="glass-text-muted border border-white/20 rounded-lg bg-black/5 p-8 text-center backdrop-blur-sm dark:border-white/10 dark:bg-black/20">
      请选择账号后查看背包
    </div>

    <div v-else-if="statusError" class="border border-red-200/50 rounded-lg bg-red-50/50 p-8 text-center text-red-500 shadow backdrop-blur-sm dark:border-red-800 dark:bg-red-900/20">
      <div class="mb-2 text-lg font-bold">
        获取数据失败
      </div>
      <div class="text-sm">
        {{ statusError }}
      </div>
    </div>

    <div v-else-if="!status?.connection?.connected" class="glass-text-muted flex flex-col items-center justify-center gap-4 border border-white/20 rounded-lg bg-black/5 p-12 text-center shadow-sm backdrop-blur-sm dark:border-white/10 dark:bg-black/20">
      <div class="i-carbon-connection-signal-off text-4xl text-gray-400" />
      <div>
        <div class="glass-text-main text-lg font-medium">
          账号未登录
        </div>
        <div class="glass-text-muted mt-1 text-sm">
          请先运行账号或检查网络连接
        </div>
      </div>
    </div>

    <template v-else>
      <div v-if="dashboardItems.length" class="grid gap-3 lg:grid-cols-4 md:grid-cols-2">
        <div
          v-for="item in dashboardItems"
          :key="`dashboard-${item.id}`"
          class="glass-panel rounded-xl p-4 shadow"
        >
          <div class="text-xs text-gray-400 uppercase tracking-[0.2em]">
            {{ item.name }}
          </div>
          <div class="mt-2 text-lg font-semibold">
            {{ item.hoursText || `x${item.count || 0}` }}
          </div>
        </div>
      </div>

      <div v-if="activeTab === 'bag'">
        <div v-if="items.length === 0" class="glass-text-muted border border-white/20 rounded-lg bg-black/5 p-8 text-center backdrop-blur-sm dark:border-white/10 dark:bg-black/20">
          无可展示物品
        </div>

        <div v-else class="grid grid-cols-2 gap-4 lg:grid-cols-5 md:grid-cols-4 sm:grid-cols-3 xl:grid-cols-6">
          <div
            v-for="item in items"
            :key="item.id"
            class="group glass-panel relative flex flex-col border border-gray-200/50 rounded-lg p-3 transition dark:border-white/10 hover:shadow-md"
          >
            <label
              v-if="item.category === 'fruit'"
              class="absolute right-2 top-2 h-5 w-5 flex items-center justify-center rounded-full bg-white/80 text-xs shadow-sm dark:bg-black/40"
            >
              <input
                :checked="isSelected(Number(item.id || 0))"
                type="checkbox"
                @change="toggleSelectItem(Number(item.id || 0))"
              >
            </label>

            <div class="absolute left-2 top-2 text-xs text-gray-400 font-mono">
              #{{ item.id }}
            </div>

            <div
              class="thumb-wrap mb-2 mt-6 h-16 w-16 flex items-center justify-center self-center rounded-full bg-gray-50 dark:bg-gray-700/50"
              :data-fallback="(item.name || '物').slice(0, 1)"
            >
              <img
                v-if="item.image && !imageErrors[item.id]"
                :src="item.image"
                :alt="item.name"
                class="max-h-full max-w-full object-contain"
                loading="lazy"
                @error="imageErrors[item.id] = true"
              >
              <div v-else class="text-2xl text-gray-400 font-bold uppercase">
                {{ (item.name || '物').slice(0, 1) }}
              </div>
            </div>

            <div class="mb-1 w-full truncate px-2 text-center text-sm font-bold" :title="item.name">
              {{ item.name || `物品${item.id}` }}
            </div>

            <div class="mb-2 flex flex-col items-center gap-0.5 text-center text-xs text-gray-400">
              <span>
                {{ item.category === 'fruit' ? '果实' : item.category === 'seed' ? '种子' : '物品' }}
                <span v-if="item.level > 0"> · Lv{{ item.level }}</span>
                <span v-if="item.price > 0"> · {{ item.price }}金</span>
              </span>
              <span v-if="item.category === 'fruit'" class="text-emerald-500">
                可加入手动出售
              </span>
            </div>

            <div class="mt-auto font-medium" :class="item.hoursText ? 'text-blue-500' : 'glass-text-main'">
              {{ item.hoursText || `x${item.count || 0}` }}
            </div>
          </div>
        </div>
      </div>

      <div v-else-if="activeTab === 'sell'" class="space-y-4">
        <div class="glass-panel rounded-xl p-4 shadow">
          <div class="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div class="text-lg font-semibold">
                出售预览
              </div>
              <div class="mt-1 text-sm text-gray-500">
                可出售 {{ sellPreview?.totalSellKinds || 0 }} 种，共 {{ sellPreview?.totalSellCount || 0 }} 个，预计 {{ sellPreview?.expectedGold || 0 }} 金币
              </div>
            </div>
            <div class="flex flex-wrap gap-2">
              <button class="trade-btn trade-btn-secondary" :disabled="sellPreviewLoading || actionLoading" @click="handlePreviewSell">
                刷新预览
              </button>
              <button class="trade-btn trade-btn-primary" :disabled="actionLoading" @click="handleSellByPolicy">
                全部按策略出售
              </button>
              <button class="trade-btn trade-btn-secondary" :disabled="actionLoading || selectedSellItems.length === 0" @click="handleSellSelected">
                出售选中 {{ selectedSellItems.length }} 种
              </button>
            </div>
          </div>
        </div>

        <div v-if="sellPreviewLoading" class="flex justify-center py-10">
          <div class="i-svg-spinners-90-ring-with-bg text-3xl text-blue-500" />
        </div>

        <div v-else-if="!sellPreview?.items?.length" class="glass-text-muted border border-white/20 rounded-lg bg-black/5 p-8 text-center backdrop-blur-sm dark:border-white/10 dark:bg-black/20">
          当前没有可预览的果实出售计划
        </div>

        <div v-else class="space-y-3">
          <div
            v-for="item in sellPreview.items"
            :key="`sell-${item.id}`"
            class="glass-panel flex flex-col gap-3 rounded-xl p-4 shadow sm:flex-row sm:items-center sm:justify-between"
          >
            <div class="min-w-0 flex-1">
              <div class="flex items-center gap-3">
                <label v-if="sellableIds.has(Number(item.id || 0))" class="shrink-0">
                  <input
                    :checked="isSelected(Number(item.id || 0))"
                    type="checkbox"
                    @change="toggleSelectItem(Number(item.id || 0))"
                  >
                </label>
                <div class="min-w-0">
                  <div class="truncate text-base font-semibold">
                    {{ item.name }}
                  </div>
                  <div class="mt-1 text-sm text-gray-500">
                    持有 {{ item.count }} · 出售 {{ item.sellCount }} · 保留 {{ item.keepCount }} · 单价 {{ item.unitPrice }}
                  </div>
                  <div v-if="formatPreviewReason(item)" class="mt-1 text-xs text-amber-500">
                    {{ formatPreviewReason(item) }}
                  </div>
                </div>
              </div>
            </div>
            <div class="text-right text-sm">
              <div class="font-semibold text-emerald-500">
                预计 {{ item.sellValue }} 金币
              </div>
              <div class="mt-1 text-xs text-gray-400">
                ID #{{ item.id }}
              </div>
            </div>
          </div>
        </div>
      </div>

      <div v-else class="space-y-4">
        <div class="glass-panel rounded-xl p-4 shadow">
          <div class="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div class="text-lg font-semibold">
                商城商品
              </div>
              <div class="mt-1 text-sm text-gray-500">
                可直接查询商品列表并发起通用购买
              </div>
            </div>
            <button class="trade-btn trade-btn-secondary" :disabled="mallLoading || actionLoading" @click="currentAccountId && bagStore.fetchMallGoods(currentAccountId)">
              刷新商城
            </button>
          </div>
        </div>

        <div v-if="mallLoading" class="flex justify-center py-10">
          <div class="i-svg-spinners-90-ring-with-bg text-3xl text-blue-500" />
        </div>

        <div v-else-if="!mallGoods.length" class="glass-text-muted border border-white/20 rounded-lg bg-black/5 p-8 text-center backdrop-blur-sm dark:border-white/10 dark:bg-black/20">
          商城暂无可显示商品
        </div>

        <div v-else class="grid gap-3 lg:grid-cols-2">
          <div
            v-for="goods in mallGoods"
            :key="goods.goodsId"
            class="glass-panel rounded-xl p-4 shadow"
          >
            <div class="flex items-start justify-between gap-3">
              <div class="min-w-0">
                <div class="truncate text-base font-semibold">
                  {{ goods.name }}
                </div>
                <div class="mt-1 text-sm text-gray-500">
                  商品ID #{{ goods.goodsId }} · 类型 {{ goods.type }}
                </div>
                <div class="mt-1 flex flex-wrap gap-2 text-xs">
                  <span class="rounded-full bg-emerald-100 px-2 py-1 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300">
                    {{ goods.isFree ? '免费' : `${goods.priceValue} 点券` }}
                  </span>
                  <span v-if="goods.isLimited" class="rounded-full bg-amber-100 px-2 py-1 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">
                    限购
                  </span>
                  <span v-if="goods.discount" class="rounded-full bg-sky-100 px-2 py-1 text-sky-700 dark:bg-sky-900/30 dark:text-sky-300">
                    {{ goods.discount }}
                  </span>
                </div>
              </div>
              <div class="shrink-0 text-right text-xs text-gray-400">
                包含 {{ goods.itemIds?.length || 0 }} 项
              </div>
            </div>

            <div class="mt-4 flex items-center gap-2">
              <input
                :value="getPurchaseCount(goods.goodsId)"
                type="number"
                min="1"
                class="trade-input"
                @input="updatePurchaseCount(goods.goodsId, Number(($event.target as HTMLInputElement).value || 1))"
              >
              <button class="trade-btn trade-btn-primary flex-1" :disabled="actionLoading" @click="handleBuyGoods(goods)">
                购买
              </button>
            </div>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.trade-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 999px;
  padding: 0.55rem 1rem;
  font-size: 0.875rem;
  font-weight: 600;
  transition: all 0.2s ease;
  border: 1px solid transparent;
}

.trade-btn:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.trade-btn-primary {
  background: linear-gradient(135deg, #0f766e, #14b8a6);
  color: #fff;
}

.trade-btn-secondary {
  background: rgba(15, 23, 42, 0.04);
  color: #334155;
  border-color: rgba(148, 163, 184, 0.35);
}

.trade-tab {
  border-radius: 999px;
  border: 1px solid rgba(148, 163, 184, 0.35);
  background: rgba(255, 255, 255, 0.5);
  padding: 0.55rem 1rem;
  font-size: 0.875rem;
  font-weight: 600;
  color: #475569;
}

.trade-tab.active {
  background: linear-gradient(135deg, #0f766e, #14b8a6);
  color: #fff;
  border-color: transparent;
}

.trade-input {
  width: 88px;
  border-radius: 999px;
  border: 1px solid rgba(148, 163, 184, 0.35);
  background: rgba(255, 255, 255, 0.7);
  padding: 0.55rem 0.85rem;
  font-size: 0.875rem;
}

.thumb-wrap.fallback img {
  display: none;
}

.thumb-wrap.fallback::after {
  content: attr(data-fallback);
  font-size: 1.5rem;
  font-weight: bold;
  color: #9ca3af;
  text-transform: uppercase;
}
</style>
