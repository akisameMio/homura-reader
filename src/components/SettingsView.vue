<template>
  <div class="settings-page" :class="{ 'has-detail': activeSection }">
    <header class="settings-topbar" :style="isCompact ? { paddingTop: 'env(safe-area-inset-top)' } : null">
      <div class="settings-topbar-inner">
        <button
          v-if="activeSection"
          ref="backButtonRef"
          type="button"
          class="settings-back-button"
          aria-label="返回设置"
          @click="showPreviousSection"
        >
          <MdIcon name="chevron_left" />
        </button>
        <div>
          <h1>{{ activeSection ? sectionTitles[activeSection] : '设置' }}</h1>
          <p v-if="!activeSection">让阅读，更合你的习惯。</p>
        </div>
        <span v-if="activeSection !== 'about'" class="settings-save-state">
          <MdIcon name="check" />
          <span>{{ activeSection ? '自动保存' : '更改会自动保存' }}</span>
        </span>
      </div>
    </header>
    <div v-if="isCompact && $slots.status" class="settings-import-status">
      <slot name="status"></slot>
    </div>
    <div v-if="!activeSection" class="settings-grid">
      <section class="settings-card settings-appearance" aria-labelledby="settings-appearance-title">
        <button
          type="button"
          class="settings-card-open"
          aria-label="打开外观设置"
          @click="openSection('appearance', $event)"
        >
          <span class="settings-card-open-icon">
            <MdIcon name="chevron_right" />
          </span>
        </button>
        <div class="appearance-content">
          <div class="settings-card-head">
            <h2 id="settings-appearance-title">
              <MdIcon name="palette" />
              外观
            </h2>
          </div>
          <h3>给阅读换个心情</h3>
          <p>从明亮白昼，到安静的夜间。</p>
          <MdSegmentedControl
            :model-value="theme.surfaceMode"
            :options="surfaceOptions"
            aria-label="表面模式"
            @update:model-value="setSurfaceMode"
          />
        </div>
        <p class="settings-detail-hint">更多外观设置</p>
        <div class="settings-book-stage" aria-hidden="true">
          <div class="settings-open-book">
            <div class="settings-book-page">
              <b>夏日的序章</b>
              <p>
                风穿过敞开的窗，
                <br />
                书页轻轻翻动。
              </p>
              <i v-for="line in 5" :key="line"></i>
              <span>12</span>
            </div>
            <div class="settings-book-page">
              <i v-for="line in 9" :key="line"></i>
              <span>13</span>
            </div>
          </div>
        </div>
      </section>
      <section class="settings-card settings-reading" aria-labelledby="settings-reading-title">
        <button
          type="button"
          class="settings-card-open"
          aria-label="打开阅读默认值"
          @click="openSection('reading', $event)"
        >
          <span class="settings-card-open-icon">
            <MdIcon name="chevron_right" />
          </span>
        </button>
        <div class="settings-card-head">
          <h2 id="settings-reading-title">
            <MdIcon name="auto_stories" />
            阅读默认值
          </h2>
          <span>首次打开作品时采用</span>
        </div>
        <div
          class="settings-reading-controls"
          :class="{ 'is-scrolling': readerDefaults.direction === 'vertical' }"
        >
          <div class="settings-block">
            <div class="settings-head">
              <span>翻页方式</span>
              <b>{{ transitionLabel }}</b>
            </div>
            <MdSegmentedControl
              :model-value="settings.transitionStyle"
              :options="transitionOptions"
              aria-label="翻页方式"
              @update:model-value="settings.setTransitionStyle"
            />
          </div>
          <template v-if="readerDefaults.direction !== 'vertical'">
            <div class="settings-block">
              <div class="settings-head">
                <span>阅读方向</span>
                <b>{{ directionLabel }}</b>
              </div>
              <MdSegmentedControl
                :model-value="readerDefaults.direction"
                :options="directionOptions"
                aria-label="阅读方向"
                @update:model-value="setDirection"
              />
            </div>
            <div class="settings-block">
              <div class="settings-head">
                <span>跨页布局</span>
                <b>{{ spreadLabel }}</b>
              </div>
              <MdSegmentedControl
                :model-value="readerDefaults.spread"
                :options="spreadOptions"
                aria-label="跨页布局"
                @update:model-value="setSpread"
              />
            </div>
          </template>
        </div>
        <div class="settings-reading-bottom">
          <div class="settings-block">
            <div class="settings-head">
              <span>默认字号</span>
              <b>{{ readerDefaults.fontSize }} px</b>
            </div>
            <div class="font-size-control">
              <button
                type="button"
                class="settings-icon-button"
                title="减小字号"
                aria-label="减小字号"
                :disabled="readerDefaults.fontSize <= 14"
                @click="changeDefaultFont(-2)"
              >
                <MdIcon name="remove" />
              </button>
              <MdRange
                class="settings-range"
                :model-value="readerDefaults.fontSize"
                :min="14"
                :max="28"
                :step="2"
                aria-label="默认字号"
                @update:model-value="setFontSize"
              />
              <button
                type="button"
                class="settings-icon-button"
                title="增大字号"
                aria-label="增大字号"
                :disabled="readerDefaults.fontSize >= 28"
                @click="changeDefaultFont(2)"
              >
                <MdIcon name="add" />
              </button>
            </div>
          </div>
          <MdSwitch
            v-if="readerDefaults.direction !== 'vertical'"
            :model-value="readerDefaults.verticalText"
            title="文字从上往下，各列从右往左排列，仅作用于小说分页阅读"
            @update:model-value="value => settings.setReaderDefault('verticalText', value)"
          >
            <span class="settings-value-copy">
              <b>竖排文字</b>
              <span>文字从上往下，各列从右往左</span>
            </span>
          </MdSwitch>
        </div>
        <p class="settings-detail-hint">更多阅读设置</p>
      </section>
      <section class="settings-card settings-storage" aria-labelledby="settings-storage-title">
        <button
          type="button"
          class="settings-card-open"
          aria-label="打开存储与数据"
          @click="openSection('storage', $event)"
        >
          <span class="settings-card-open-icon">
            <MdIcon name="chevron_right" />
          </span>
        </button>
        <div class="settings-card-head">
          <h2 id="settings-storage-title">
            <MdIcon name="database" />
            存储与数据
          </h2>
          <button
            type="button"
            class="settings-icon-button"
            title="刷新存储用量"
            aria-label="刷新存储用量"
            :disabled="storageLoading"
            @click="refreshStorage"
          >
            <MdIcon name="update" />
          </button>
        </div>
        <template v-if="diskSegments">
          <strong class="storage-number">{{ formatBytes(diskSegments.appBytes) }}</strong>
          <p class="settings-note">HOMURA 占用 · 共 {{ storageTotalText }}</p>
          <div
            class="storage-stack"
            :class="{ 'is-revealing': storageRevealing }"
            role="img"
            :aria-label="storageAriaLabel"
          >
            <i class="storage-seg storage-seg-app" :style="{ width: segmentWidth(diskSegments.appRatio) }"></i>
            <i
              class="storage-seg storage-seg-other"
              :style="{ width: segmentWidth(diskSegments.otherRatio) }"
            ></i>
            <i class="storage-seg storage-seg-free" :style="{ width: segmentWidth(diskSegments.freeRatio) }"></i>
          </div>
          <div class="storage-legend">
            <div>
              <i class="storage-dot storage-seg-app"></i>
              <span>HOMURA</span>
              <b>{{ formatBytes(diskSegments.appBytes) }}</b>
            </div>
            <div>
              <i class="storage-dot storage-seg-other"></i>
              <span>其他应用</span>
              <b>{{ formatBytes(diskSegments.otherBytes) }}</b>
            </div>
            <div>
              <i class="storage-dot storage-seg-free"></i>
              <span>可用空间</span>
              <b>{{ formatBytes(diskSegments.freeBytes) }}</b>
            </div>
          </div>
        </template>
        <template v-else>
          <strong class="storage-number">{{ storageUsageText }}</strong>
          <p class="settings-note">{{ nativeStorageEnabled ? 'WebView 本地数据' : '浏览器本地数据' }}</p>
          <div
            class="storage-bar"
            :class="{ 'is-revealing': storageRevealing }"
            role="progressbar"
            aria-label="本地存储用量"
            aria-valuemin="0"
            aria-valuemax="100"
            :aria-valuenow="storagePercent"
          >
            <i :style="{ width: storageBarWidth }"></i>
          </div>
          <p class="settings-note">{{ storageQuotaText }}</p>
          <p v-if="nativeStorageEnabled" class="settings-note">原始文件存入本机，容量受磁盘剩余空间限制。</p>
        </template>
        <p class="settings-detail-hint">管理本机数据</p>
      </section>
      <section class="settings-card settings-about" aria-labelledby="settings-about-title">
        <button
          type="button"
          class="settings-card-open"
          aria-label="打开关于 HOMURA"
          @click="openSection('about', $event)"
        >
          <span class="settings-card-open-icon">
            <MdIcon name="chevron_right" />
          </span>
        </button>
        <div class="settings-card-head">
          <h2 id="settings-about-title">
            <MdIcon name="info" />
            关于 HOMURA
          </h2>
          <span class="settings-badge">MIT 开源</span>
        </div>
        <div class="about-version">
          <img :src="logoUrl" alt="HOMURA 应用图标" />
          <div>
            <h3>
              HOMURA
              <span>{{ appVersion }}</span>
            </h3>
            <p class="settings-note">本地优先的 ACGN 阅读器</p>
          </div>
        </div>
        <div class="settings-card-actions">
          <button type="button" class="settings-tonal-button" @click="updates.handlePrimaryUpdateAction">{{ hasPendingInstall ? '继续安装' : '检查更新' }}</button>
          <button type="button" class="settings-text-button" @click="updates.openChangelog">
            更新日志
            <i v-if="hasNewRelease" class="about-log-new" aria-label="有新版本"></i>
          </button>
        </div>
        <button type="button" class="settings-text-button about-repository" @click="openRepository">
          开源仓库
          <MdIcon name="open_in_new" />
        </button>
        <p v-if="aboutLinkError" class="settings-note" role="alert">{{ aboutLinkError }}</p>
      </section>
      <section class="settings-card settings-import" aria-labelledby="settings-import-title">
        <button
          type="button"
          class="settings-card-open"
          aria-label="打开导入偏好"
          @click="openSection('import', $event)"
        >
          <span class="settings-card-open-icon">
            <MdIcon name="chevron_right" />
          </span>
        </button>
        <div class="settings-card-head">
          <h2 id="settings-import-title">
            <MdIcon name="upload_file" />
            导入偏好
          </h2>
        </div>
        <MdSwitch
          :model-value="settings.importCollectionPrompt"
          title="导入多本作品时询问是否创建书库"
          @update:model-value="settings.setImportCollectionPrompt"
        >
          <span class="settings-value-copy">
            <b>导入时询问创建书库</b>
            <span>按目录整理，一次归好类。</span>
          </span>
        </MdSwitch>
        <p class="settings-note">{{ settings.importCollectionPrompt ? '导入多本作品时，按目录询问' : '默认直接导入' }}</p>
      </section>
      <section class="settings-card settings-debug" aria-labelledby="settings-debug-title">
        <button
          type="button"
          class="settings-card-open"
          aria-label="打开调试设置"
          @click="openSection('debug', $event)"
        >
          <span class="settings-card-open-icon">
            <MdIcon name="chevron_right" />
          </span>
        </button>
        <div class="settings-card-head">
          <h2 id="settings-debug-title">
            <MdIcon name="science" />
            调试
          </h2>
        </div>
        <p class="settings-debug-copy">调试与实验功能</p>
        <p class="settings-note">自动检查更新、全屏入口与示例内容。</p>
        <p class="settings-detail-hint">打开调试设置</p>
      </section>
    </div>
    <div v-else class="settings-detail">
      <template v-if="activeSection === 'appearance'">
        <div class="settings-detail-hero settings-surface-hero">
          <SettingsInterfacePreview />
        </div>
        <section class="settings-detail-group" aria-labelledby="settings-surface-heading">
          <h2 id="settings-surface-heading">
            <MdIcon name="light_mode" />
            表面模式
          </h2>
          <div class="settings-list" role="group" aria-label="表面模式">
            <button
              v-for="option in detailSurfaceOptions"
              :key="option.value"
              type="button"
              class="settings-list-row settings-surface-row"
              :aria-pressed="theme.surfaceMode === option.value"
              @click="selectSurfaceMode(option.value, $event)"
            >
              <SettingsInterfacePreview :mode="option.value" thumbnail />
              <span class="settings-value-copy">
                <b>{{ option.label }}</b>
                <span>{{ option.description }}</span>
              </span>
              <MdIcon v-if="theme.surfaceMode === option.value" name="check" class="settings-row-check" />
            </button>
          </div>
          <p class="settings-detail-note">更改即时应用到整个应用，也会自动保存。</p>
        </section>
        <section class="settings-detail-group" aria-labelledby="settings-black-heading">
          <h2 id="settings-black-heading">
            <MdIcon name="contrast" />
            纯黑模式
          </h2>
          <div class="settings-list" role="group" aria-label="纯黑模式">
            <button
              v-for="option in pureBlackOptions"
              :key="option.black"
              type="button"
              class="settings-list-row settings-surface-row"
              :aria-pressed="theme.pureBlackMode === option.value"
              @click="selectPureBlackMode(option.value, $event)"
            >
              <SettingsInterfacePreview mode="dark" :black="option.black" thumbnail />
              <span class="settings-value-copy">
                <b>{{ option.label }}</b>
              </span>
              <MdIcon v-if="theme.pureBlackMode === option.value" name="check" class="settings-row-check" />
            </button>
          </div>
          <p class="settings-detail-note">仅在夜间模式下生效，跟随系统时也会自动应用。</p>
        </section>
        <section class="settings-detail-group" aria-labelledby="settings-colors-heading">
          <h2 id="settings-colors-heading">
            <MdIcon name="palette" />
            主题色彩
            <span class="settings-color-name">{{ themeLabel }}</span>
          </h2>
          <div class="settings-list settings-color-strip">
            <ThemeSwatchGrid strip />
          </div>
        </section>
      </template>
      <template v-else-if="activeSection === 'reading'">
        <div class="settings-detail-hero settings-reading-hero">
          <div class="settings-book-stage" aria-hidden="true">
            <div class="settings-open-book">
              <div class="settings-book-page">
                <b>夏日的序章</b>
                <p>
                  风穿过敞开的窗，
                  <br />
                  书页轻轻翻动。
                </p>
                <i v-for="line in 5" :key="line"></i>
                <span>12</span>
              </div>
              <div class="settings-book-page">
                <i v-for="line in 9" :key="line"></i>
                <span>13</span>
              </div>
            </div>
          </div>
          <div class="settings-hero-copy">
            <span class="settings-badge">阅读示意</span>
            <h2>找到舒服的阅读节奏</h2>
            <p>首次打开作品时，从这里开始。</p>
          </div>
        </div>
        <section class="settings-detail-group" aria-labelledby="settings-layout-heading">
          <h2 id="settings-layout-heading">翻页与布局</h2>
          <div class="settings-list">
            <SettingsSelectRow
              label="翻页方式"
              :model-value="settings.transitionStyle"
              :options="transitionOptions"
              @update:model-value="settings.setTransitionStyle"
            />
            <template v-if="readerDefaults.direction !== 'vertical'">
              <SettingsSelectRow
                label="阅读方向"
                :model-value="readerDefaults.direction"
                :options="directionOptions"
                @update:model-value="setDirection"
              />
              <SettingsSelectRow
                label="跨页布局"
                :model-value="readerDefaults.spread"
                :options="spreadOptions"
                @update:model-value="setSpread"
              />
              <MdSwitch
                v-if="readerDefaults.spread === 2"
                class="settings-list-row"
                :model-value="readerDefaults.coverOffset"
                title="让后续跨页大图保持对齐"
                @update:model-value="value => settings.setReaderDefault('coverOffset', value)"
              >
                <span class="settings-value-copy">
                  <b>首页单排</b>
                  <span>让后续跨页大图保持对齐</span>
                </span>
              </MdSwitch>
              <MdSwitch
                class="settings-list-row"
                :model-value="readerDefaults.verticalText"
                title="文字从上往下，各列从右往左排列，仅作用于小说分页阅读"
                @update:model-value="value => settings.setReaderDefault('verticalText', value)"
              >
                <span class="settings-value-copy">
                  <b>竖排文字</b>
                  <span>文字从上往下，各列从右往左</span>
                </span>
              </MdSwitch>
            </template>
          </div>
        </section>
        <section class="settings-detail-group" aria-labelledby="settings-text-heading">
          <h2 id="settings-text-heading">文字与滚动</h2>
          <div class="settings-list">
            <div class="settings-detail-font">
              <div class="settings-head">
                <span>默认字号</span>
                <b>{{ readerDefaults.fontSize }} px</b>
              </div>
              <div class="font-size-control">
                <button
                  type="button"
                  class="settings-icon-button"
                  title="减小字号"
                  aria-label="减小字号"
                  :disabled="readerDefaults.fontSize <= 14"
                  @click="changeDefaultFont(-2)"
                >
                  <MdIcon name="remove" />
                </button>
                <MdRange
                  class="settings-range"
                  :model-value="readerDefaults.fontSize"
                  :min="14"
                  :max="28"
                  :step="2"
                  aria-label="默认字号"
                  @update:model-value="setFontSize"
                />
                <button
                  type="button"
                  class="settings-icon-button"
                  title="增大字号"
                  aria-label="增大字号"
                  :disabled="readerDefaults.fontSize >= 28"
                  @click="changeDefaultFont(2)"
                >
                  <MdIcon name="add" />
                </button>
              </div>
            </div>
            <SettingsSelectRow
              label="滚动宽度"
              :model-value="readerDefaults.webtoonFit"
              :options="webtoonOptions"
              @update:model-value="value => settings.setReaderDefault('webtoonFit', value)"
            />
            <MdSwitch
              v-if="isAndroid"
              class="settings-list-row"
              :model-value="settings.volumeKeysTurnPage"
              title="音量加键上一页、音量减键下一页"
              @update:model-value="settings.setVolumeKeysTurnPage"
            >
              <span class="settings-value-copy">
                <b>用音量键翻页</b>
                <span>音量加键上一页、音量减键下一页</span>
              </span>
            </MdSwitch>
          </div>
          <p class="settings-detail-note">每本书已有的阅读位置与排版记忆会继续保留。</p>
        </section>
        <button type="button" class="settings-text-button" @click="settings.resetReaderDefaults">恢复阅读默认值</button>
      </template>
      <template v-else-if="activeSection === 'storage'">
        <div class="settings-detail-hero settings-storage-hero">
          <div class="settings-storage-hero-head">
            <span>本机存储用量</span>
            <button
              type="button"
              class="settings-icon-button"
              title="刷新存储用量"
              aria-label="刷新存储用量"
              :disabled="storageLoading"
              @click="refreshStorage"
            >
              <MdIcon name="update" />
            </button>
          </div>
          <template v-if="diskSegments">
            <strong class="storage-number">{{ formatBytes(diskSegments.appBytes) }}</strong>
            <p class="settings-note">HOMURA 占用 · 共 {{ storageTotalText }}</p>
            <div
              class="storage-stack"
              :class="{ 'is-revealing': storageRevealing }"
              role="img"
              :aria-label="storageAriaLabel"
            >
              <i class="storage-seg storage-seg-app" :style="{ width: segmentWidth(diskSegments.appRatio) }"></i>
              <i
                class="storage-seg storage-seg-other"
                :style="{ width: segmentWidth(diskSegments.otherRatio) }"
              ></i>
              <i
                class="storage-seg storage-seg-free"
                :style="{ width: segmentWidth(diskSegments.freeRatio) }"
              ></i>
            </div>
            <div class="storage-legend">
              <div>
                <i class="storage-dot storage-seg-app"></i>
                <span>HOMURA</span>
                <b>{{ formatBytes(diskSegments.appBytes) }}</b>
              </div>
              <div>
                <i class="storage-dot storage-seg-other"></i>
                <span>其他应用</span>
                <b>{{ formatBytes(diskSegments.otherBytes) }}</b>
              </div>
              <div>
                <i class="storage-dot storage-seg-free"></i>
                <span>可用空间</span>
                <b>{{ formatBytes(diskSegments.freeBytes) }}</b>
              </div>
            </div>
          </template>
          <template v-else>
            <strong class="storage-number">{{ storageUsageText }}</strong>
            <p class="settings-note">{{ nativeStorageEnabled ? 'WebView 本地数据' : '浏览器本地数据' }}</p>
            <div
              class="storage-bar"
              :class="{ 'is-revealing': storageRevealing }"
              role="progressbar"
              aria-label="本地存储用量"
              aria-valuemin="0"
              aria-valuemax="100"
              :aria-valuenow="storagePercent"
            >
              <i :style="{ width: storageBarWidth }"></i>
            </div>
            <p class="settings-note">{{ storageQuotaText }}</p>
            <p v-if="nativeStorageEnabled" class="settings-note">原始文件存入本机，容量受磁盘剩余空间限制。</p>
          </template>
        </div>
        <section v-if="diskSegments" class="settings-detail-group" aria-labelledby="settings-usage-heading">
          <h2 id="settings-usage-heading">本机用量</h2>
          <div class="settings-list">
            <div class="settings-list-row">
              <span class="settings-row-icon">
                <MdIcon name="folder_open" />
              </span>
              <span class="settings-value-copy">
                <b>原始文件与缓存</b>
              </span>
              <b class="settings-row-value">{{ storageNativeText }}</b>
            </div>
            <div class="settings-list-row">
              <span class="settings-row-icon">
                <MdIcon name="database" />
              </span>
              <span class="settings-value-copy">
                <b>WebView 本地数据</b>
              </span>
              <b class="settings-row-value">{{ storageWebviewText }}</b>
            </div>
          </div>
        </section>
        <section class="settings-detail-group" aria-labelledby="settings-data-heading">
          <h2 id="settings-data-heading">数据管理</h2>
          <div class="settings-list">
            <div class="settings-list-row">
              <span class="settings-value-copy">
                <b>阅读进度</b>
                <span>{{ progressCount }} 本作品保留阅读位置与排版</span>
              </span>
              <button
                type="button"
                class="settings-text-button"
                :disabled="progressCount === 0 || actionBusy"
                @click="requestDataAction('progress')"
              >
                清空进度
              </button>
            </div>
            <div class="settings-list-row">
              <span class="settings-value-copy">
                <b>书架与原始文件</b>
                <span>{{ shelf.library.length }} 部作品，删除后无法恢复</span>
              </span>
              <button
                type="button"
                class="settings-text-button"
                :disabled="shelf.library.length === 0 || actionBusy"
                @click="requestDataAction('shelf')"
              >
                清空书架
              </button>
            </div>
          </div>
          <p class="settings-detail-note">清空前会再次确认。删除书架会同时删除原始文件与阅读记录。</p>
          <p v-if="actionNote" class="settings-detail-note" role="status">{{ actionNote }}</p>
        </section>
      </template>
      <template v-else-if="activeSection === 'about'">
        <div class="settings-detail-hero settings-about-hero">
          <img :src="logoUrl" alt="HOMURA 应用图标" />
          <h2>HOMURA</h2>
          <span class="settings-badge">{{ appVersion }}</span>
          <p>把故事留在本机，把阅读留给自己。</p>
          <p class="settings-note">
            漫画、轻小说与图集都在设备内解析。
            <br />
            作品与阅读记录不上传服务器。
          </p>
        </div>
        <section class="settings-detail-group" aria-labelledby="settings-update-heading">
          <h2 id="settings-update-heading">版本与更新</h2>
          <div class="settings-list">
            <button type="button" class="settings-list-row" @click="updates.handlePrimaryUpdateAction">
              <span class="settings-row-icon">
                <MdIcon name="update" />
              </span>
              <span class="settings-value-copy">
                <b>{{ hasPendingInstall ? '继续安装' : '检查更新' }}</b>
              </span>
              <span class="settings-row-value">{{ hasPendingInstall ? '安装包已就绪' : '手动检查' }}</span>
              <MdIcon name="chevron_right" />
            </button>
            <button type="button" class="settings-list-row" @click="updates.openChangelog">
              <span class="settings-row-icon">
                <MdIcon name="article" />
              </span>
              <span class="settings-value-copy">
                <b>更新日志</b>
              </span>
              <i v-if="hasNewRelease" class="about-log-new" aria-label="有新版本"></i>
              <MdIcon name="chevron_right" />
            </button>
          </div>
        </section>
        <section class="settings-detail-group" aria-labelledby="settings-open-source-heading">
          <h2 id="settings-open-source-heading">开源信息</h2>
          <div class="settings-list">
            <button type="button" class="settings-list-row" @click="openRepository">
              <span class="settings-row-icon">
                <MdIcon name="open_in_new" />
              </span>
              <span class="settings-value-copy">
                <b>开源仓库</b>
              </span>
              <span class="settings-row-value">GitHub</span>
              <MdIcon name="chevron_right" />
            </button>
            <div class="settings-list-row">
              <span class="settings-row-icon">
                <MdIcon name="info" />
              </span>
              <span class="settings-value-copy">
                <b>开源许可</b>
              </span>
              <span class="settings-row-value">MIT License</span>
            </div>
          </div>
          <p class="settings-detail-note">© Leo NING · AkisameRin</p>
          <p v-if="aboutLinkError" class="settings-detail-note" role="alert">{{ aboutLinkError }}</p>
        </section>
      </template>
      <template v-else-if="activeSection === 'import'">
        <div class="settings-detail-hero settings-import-hero">
          <div class="settings-import-diagram" aria-hidden="true">
            <span class="settings-import-folder">
              <MdIcon name="folder_open" />
            </span>
            <MdIcon name="chevron_right" />
            <span class="settings-import-books">
              <i></i>
              <i></i>
              <i></i>
            </span>
          </div>
          <h2>让作品，井井有条</h2>
          <p>从文件夹到书库，保留你熟悉的整理方式。</p>
        </div>
        <section class="settings-detail-group" aria-labelledby="settings-import-behavior-heading">
          <h2 id="settings-import-behavior-heading">导入行为</h2>
          <div class="settings-list">
            <MdSwitch
              class="settings-list-row"
              :model-value="settings.importCollectionPrompt"
              title="导入多本作品时询问是否创建书库"
              @update:model-value="settings.setImportCollectionPrompt"
            >
              <span class="settings-value-copy">
                <b>导入时询问创建书库</b>
                <span>导入多本作品时，按目录询问</span>
              </span>
            </MdSwitch>
          </div>
          <p class="settings-detail-note">关闭后直接导入作品；开启后，目录导入会先询问是否按目录创建一级书库。</p>
        </section>
        <p class="settings-quiet-note">偏好会自动保存，仅影响之后的导入。</p>
      </template>
      <template v-else-if="activeSection === 'debug'">
        <section class="settings-detail-group" aria-labelledby="settings-debug-general-heading">
          <h2 id="settings-debug-general-heading">更新与界面</h2>
          <div class="settings-list">
            <MdSwitch
              class="settings-list-row"
              :model-value="settings.debugAutoUpdateCheck"
              title="启动时自动检查 GitHub 稳定版更新"
              @update:model-value="settings.setDebugAutoUpdateCheck"
            >
              <span class="settings-value-copy">
                <b>启动时静默检查更新</b>
                <span>启动时请求官方稳定版更新信息</span>
              </span>
            </MdSwitch>
            <MdSwitch
              class="settings-list-row"
              :model-value="settings.debugForceFullscreen"
              title="在非 Windows 系统也显示全屏入口"
              @update:model-value="settings.setDebugForceFullscreen"
            >
              <span class="settings-value-copy">
                <b>强制显示全屏组件</b>
                <span>{{ isWindows ? 'Windows 默认显示' : '在非 Windows 系统也显示全屏入口' }}</span>
              </span>
            </MdSwitch>
          </div>
          <p class="settings-detail-note">这些调试偏好只保存在此设备。</p>
        </section>
        <section class="settings-detail-group" aria-labelledby="settings-demo-heading">
          <h2 id="settings-demo-heading">示例内容</h2>
          <div class="settings-list">
            <div class="settings-list-row">
              <span class="settings-row-icon">
                <MdIcon name="auto_stories" />
              </span>
              <span class="settings-value-copy">
                <b>示例漫画</b>
                <span>6 页分镜样张，检查单双页、日漫方向与滚动阅读。</span>
              </span>
              <button type="button" class="settings-text-button" @click="addDemoManga">添加漫画</button>
            </div>
            <div class="settings-list-row">
              <span class="settings-row-icon">
                <MdIcon name="article" />
              </span>
              <span class="settings-value-copy">
                <b>示例小说</b>
                <span>2 章 EPUB 样张，检查字号、分页与进度恢复。</span>
              </span>
              <button type="button" class="settings-text-button" @click="addDemoNovel">添加小说</button>
            </div>
          </div>
          <p class="settings-detail-note">示例只会加入本机书架，不会替换已有作品。</p>
          <p v-if="debugNote" class="settings-detail-note" role="status">{{ debugNote }}</p>
        </section>
      </template>
    </div>
    <footer class="settings-footer">
      <span>阅读记录与作品，只保存在此设备。</span>
      <span>HOMURA · ACGN GO</span>
    </footer>
    <Teleport to="body">
      <Transition
        enter-active-class="settings-dialog-enter-active"
        enter-from-class="settings-dialog-enter"
        enter-to-class="settings-dialog-enter-to"
        leave-active-class="settings-dialog-leave-active"
        leave-from-class="settings-dialog-leave-from"
        leave-to-class="settings-dialog-leave-to"
      >
        <div v-if="pendingAction" class="settings-dialog-layer" @mousedown.self="closeDataDialog">
          <section
            class="settings-dialog"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="settings-dialog-title"
            aria-describedby="settings-dialog-copy"
            :aria-busy="actionBusy"
          >
            <div class="settings-dialog-icon" aria-hidden="true">
              <MdIcon name="delete" />
            </div>
            <h3 id="settings-dialog-title">{{ dataDialogTitle }}</h3>
            <p id="settings-dialog-copy">{{ dataDialogDescription }}</p>
            <div class="settings-dialog-actions">
              <button
                ref="cancelButtonRef"
                type="button"
                class="settings-dialog-button is-secondary"
                :disabled="actionBusy"
                @click="closeDataDialog"
              >
                取消
              </button>
              <button
                ref="confirmButtonRef"
                type="button"
                class="settings-dialog-button is-primary"
                :disabled="actionBusy"
                @click="confirmDataAction"
              >
                {{ actionBusy ? '正在清空' : '确认清空' }}
              </button>
            </div>
          </section>
        </div>
      </Transition>
    </Teleport>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue';
import { storeToRefs } from 'pinia';
import packageInfo from '../../package.json';
import { createDemoManga, createDemoNovel } from '../services/demo.ts';
import { HomuraStore } from '../services/storage.ts';
import { canUseNativeStorage } from '../services/nativeStorage.ts';
import { buildStorageSegments, readDiskStorageStats } from '../services/storageStats.ts';
import type { DiskStorageStats } from '../services/storageStats.ts';
import { formatBytes, isAndroid, isWindows } from '../services/platform.ts';
import { openGitHubUrl } from '../services/external.ts';
import { REPOSITORY_URL } from '../services/updates.ts';
import { useShelfStore } from '../stores/shelf.ts';
import { useSettingsStore } from '../stores/settings.ts';
import {
  SURFACE_MODE_OPTIONS,
  THEME_OPTIONS,
  TRANSITION_LABELS,
  TRANSITION_OPTIONS,
  useThemeStore
} from '../stores/theme.ts';
import { WEBTOON_FIT_LABELS } from '../stores/reader.ts';
import { useUpdateStore } from '../stores/updates.ts';
import { useViewport } from '../composables/useViewport.ts';
import MdIcon from './MdIcon.vue';
import MdRange from './MdRange.vue';
import MdSegmentedControl from './MdSegmentedControl.vue';
import MdSwitch from './MdSwitch.vue';
import ThemeSwatchGrid from './ThemeSwatchGrid.vue';
import SettingsInterfacePreview from './SettingsInterfacePreview.vue';
import SettingsSelectRow from './SettingsSelectRow.vue';
import { scrollAppToTop } from '../services/utils.ts';

const logoUrl = import.meta.env.BASE_URL + 'favicon.png';
const shelf = useShelfStore();
const settings = useSettingsStore();
const theme = useThemeStore();
const updates = useUpdateStore();
const { hasNewRelease, hasPendingInstall } = storeToRefs(updates);
const appVersion = packageInfo.version;
const { isCompact } = useViewport();
const readerDefaults = settings.readerDefaults;
const aboutLinkError = ref('');
const debugNote = ref('');

const transitionOptions = TRANSITION_OPTIONS;
const directionOptions = [
  { value: 'ltr', label: '从左到右', title: '普通排版' },
  { value: 'rtl', label: '从右到左', title: '日漫' }
];
const spreadOptions = [
  { value: 1, label: '单页' },
  { value: 2, label: '双页' }
];
const webtoonOptions = [
  { value: 'screen', label: WEBTOON_FIT_LABELS.screen },
  { value: 'medium', label: WEBTOON_FIT_LABELS.medium },
  { value: 'wide', label: WEBTOON_FIT_LABELS.wide }
];

const emit = defineEmits(['detail-change']);
const sectionTitles = {
  appearance: '外观', reading: '阅读默认值', storage: '存储与数据',
  about: '关于 HOMURA', import: '导入偏好', debug: '调试'
};
type SettingsSection = keyof typeof sectionTitles;
const activeSection = ref<SettingsSection | null>(null);
const backButtonRef = shallowRef<HTMLButtonElement | null>(null);
const sectionHistory: {
  section: SettingsSection | null;
  scrollTop: number;
  trigger: HTMLElement;
  selector: string;
}[] = [];
const detailSurfaceOptions = ['auto', 'light', 'dark'].map(value => {
  const option = SURFACE_MODE_OPTIONS.find(item => item.value === value)!;
  return {
    ...option,
    label: value === 'auto' ? '跟随系统' : option.label,
    description: value === 'auto' ? '自动适应系统的深浅色' : value === 'light' ? '明亮、清爽的阅读界面' : '柔和低光，留给安静的夜晚'
  };
});
const pureBlackOptions = [
  { value: false, label: '标准', black: 'standard' },
  { value: true, label: '纯黑', black: 'pure' }
];
const surfaceOptions = SURFACE_MODE_OPTIONS.map(option => ({
  ...option,
  label: option.value === 'auto' ? '跟随系统' : option.label
}));

const themeLabel = computed(() => {
  const option = THEME_OPTIONS.find(item => item.name === theme.themeColor);
  return option ? option.title.replace(' (默认)', '') : theme.themeColor;
});
const transitionLabel = computed(() => TRANSITION_LABELS[settings.transitionStyle] || '');
const directionLabel = computed(() => {
  const option = directionOptions.find(item => item.value === readerDefaults.direction);
  return option ? option.label : '';
});
const spreadLabel = computed(() => readerDefaults.spread === 2 ? '双页' : '单页');
const storageInfo = ref<{ usage: number; quota: number; ratio: number } | null>(null);
const diskStats = ref<DiskStorageStats | null>(null);
const storageRevealing = ref(false);
const nativeStorageEnabled = canUseNativeStorage();
const storageLoading = ref(true);
const actionNote = ref('');
const pendingAction = ref<string | null>(null);
const actionBusy = ref(false);
const cancelButtonRef = ref<HTMLButtonElement | null>(null);
const confirmButtonRef = ref<HTMLButtonElement | null>(null);
let dialogTrigger: HTMLElement | null = null;
const modalLayerOpen = computed(() => !!pendingAction.value);
let previousModalBodyOverflow = '';
let modalLayerLocked = false;

const storageUsageText = computed(() => {
  if (storageLoading.value) return '正在读取';
  if (!storageInfo.value) return '无法估算';
  return formatBytes(storageInfo.value.usage || 0);
});
const storageQuotaText = computed(() => {
  if (storageLoading.value) return '';
  if (!storageInfo.value || !storageInfo.value.quota) return '当前环境未提供容量信息';
  const free = Math.max(0, storageInfo.value.quota - storageInfo.value.usage);
  return `可用 ${formatBytes(free)}`;
});
const storagePercent = computed(() => {
  const ratio = (storageInfo.value && storageInfo.value.ratio) || 0;
  return Number.isFinite(ratio) ? Math.min(100, Math.max(0, Math.round(ratio * 100))) : 0;
});
const storageBarWidth = computed(() => {
  const ratio = storageInfo.value?.ratio || 0;
  if (!Number.isFinite(ratio) || ratio <= 0) return '0%';
  return `max(3px, ${(Math.min(1, ratio) * 100).toFixed(3)}%)`;
});
// 应用总占用 = AppData / AppCache + WebView 本地数据，两者不在同一个目录。
const diskSegments = computed(() => {
  if (!diskStats.value) return null;
  return buildStorageSegments({
    ...diskStats.value,
    appBytes: diskStats.value.appBytes + (storageInfo.value?.usage || 0)
  });
});
const storageTotalText = computed(() =>
  diskSegments.value ? formatBytes(diskSegments.value.totalBytes) : ''
);
const storageNativeText = computed(() =>
  diskStats.value ? formatBytes(diskStats.value.appBytes) : '0 B'
);
const storageWebviewText = computed(() => formatBytes(storageInfo.value?.usage || 0));
const storageAriaLabel = computed(() => {
  const segments = diskSegments.value;
  if (!segments) return '磁盘存储用量';
  return `HOMURA 使用 ${formatBytes(segments.appBytes)}，其他应用使用 ${formatBytes(segments.otherBytes)}，磁盘剩余 ${formatBytes(segments.freeBytes)}`;
});
const progressCount = computed(() => Object.keys(shelf.progressMap || {}).length);
const dataDialogTitle = computed(() =>
  pendingAction.value === 'shelf' ? '清空书架与原始文件？' : '清空阅读进度？'
);
const dataDialogDescription = computed(() => {
  if (pendingAction.value === 'shelf') {
    return `将删除 ${shelf.library.length} 部作品、原始文件与阅读记录。此操作无法撤销。`;
  }
  return `将删除 ${progressCount.value} 本作品的阅读位置与排版记忆。作品本身不会被删除。`;
});

function setDirection(value: string) {
  settings.setReaderDefault('direction', value);
}

// 占比极小时仍保留 3px，避免本应用的使用量在进度条上完全消失。
function segmentWidth(ratio: number) {
  if (!Number.isFinite(ratio) || ratio <= 0) return '0%';
  return `max(3px, ${(Math.min(1, ratio) * 100).toFixed(3)}%)`;
}

function setSpread(value: number | string) {
  settings.setReaderDefault('spread', Number(value));
}

function setFontSize(value: number | string) {
  settings.setReaderDefault('fontSize', Number(value));
}

function changeDefaultFont(delta: number) {
  settings.setReaderDefault('fontSize', readerDefaults.fontSize + delta);
}

async function refreshStorage() {
  storageRevealing.value = false;
  storageLoading.value = true;
  const [info, disk] = await Promise.all([
    HomuraStore.estimateStorage(),
    readDiskStorageStats()
  ]);
  storageInfo.value = info;
  diskStats.value = disk;
  storageLoading.value = false;
  await nextTick();
  storageRevealing.value = true;
}

async function openRepository() {
  aboutLinkError.value = '';
  try {
    await openGitHubUrl(REPOSITORY_URL);
  } catch (error) {
    aboutLinkError.value = '无法打开系统浏览器，请稍后再试。';
    console.warn('打开开源仓库失败', error);
  }
}


function settingsScroller() {
  const node = document.querySelector<HTMLElement>('[data-app-scroll]');
  return node && /auto|scroll/.test(getComputedStyle(node).overflowY) ? node : null;
}

async function openSection(section: SettingsSection, event: MouseEvent) {
  sectionHistory.push({
    section: activeSection.value,
    scrollTop: settingsScroller()?.scrollTop ?? window.scrollY,
    trigger: event.currentTarget as HTMLElement,
    selector: `.settings-${section} > .settings-card-open`
  });
  activeSection.value = section;
  emit('detail-change', true);
  await nextTick();
  scrollAppToTop();
  backButtonRef.value?.focus({ preventScroll: true });
  if (section === 'storage' && !storageLoading.value) refreshStorage();
}

async function showPreviousSection() {
  if (actionBusy.value) return;
  const previous = sectionHistory.pop();
  activeSection.value = previous?.section ?? null;
  emit('detail-change', !!activeSection.value);
  await nextTick();
  const scroller = settingsScroller();
  const scrollTop = previous?.scrollTop ?? 0;
  if (scroller) scroller.scrollTo({ top: scrollTop, behavior: 'instant' });
  else window.scrollTo({ top: scrollTop, behavior: 'instant' });
  // 上一页由 v-if 重建时，重新定位入口，恢复焦点与原滚动位置。
  const trigger = previous?.trigger.isConnected
    ? previous.trigger
    : previous ? document.querySelector<HTMLElement>(previous.selector) : null;
  trigger?.focus({ preventScroll: true });
}

function dismissBack() {
  if (pendingAction.value) {
    closeDataDialog();
    return true;
  }
  if (!activeSection.value) return false;
  showPreviousSection();
  return true;
}

defineExpose({ dismissBack });

function selectSurfaceMode(value: string, event: MouseEvent) {
  const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
  setSurfaceMode(value, { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 });
}

function selectPureBlackMode(value: boolean, event: MouseEvent) {
  const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
  theme.setPureBlackMode(value, { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 });
}

function setSurfaceMode(value: string, origin: { x: number; y: number } | null) {
  theme.setSurfaceMode(value, false, origin);
}

function addDemoManga() {
  const book = createDemoManga();
  shelf.unshiftBook(book);
  debugNote.value = `已添加「${book.title}」`;
}

function addDemoNovel() {
  const book = createDemoNovel();
  shelf.unshiftBook(book);
  debugNote.value = `已添加「${book.title}」`;
}

function requestDataAction(action: string) {
  if (actionBusy.value) return;
  dialogTrigger = document.activeElement as HTMLElement | null;
  pendingAction.value = action;
}

function closeDataDialog() {
  if (actionBusy.value) return;
  pendingAction.value = null;
}

async function confirmDataAction() {
  if (!pendingAction.value || actionBusy.value) return;
  const action = pendingAction.value;
  actionBusy.value = true;
  try {
    if (action === 'shelf') {
      await shelf.clearShelf();
      actionNote.value = '书架与原始文件已清空';
    } else {
      await shelf.clearProgress();
      actionNote.value = '阅读进度已清空';
    }
  } catch (err) {
    actionNote.value = (err as Error).message || '清空失败，请重试';
    console.warn('[HOMURA] 清空数据失败', err);
  } finally {
    await refreshStorage();
    actionBusy.value = false;
    pendingAction.value = null;
  }
}

function onDialogKeydown(event: KeyboardEvent) {
  if (!pendingAction.value) {
    if (event.key === 'Escape' && activeSection.value && !updates.changelogOpen && !updates.updateDialogOpen) {
      event.preventDefault();
      showPreviousSection();
    }
    return;
  }
  if (event.key === 'Escape') {
    event.preventDefault();
    closeDataDialog();
    return;
  }
  if (event.key !== 'Tab') return;
  const focusable = ([cancelButtonRef.value, confirmButtonRef.value].filter(Boolean)) as HTMLElement[];
  if (focusable.length === 0) return;
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

watch(pendingAction, async (value, previous) => {
  if (value) {
    await nextTick();
    cancelButtonRef.value?.focus();
    return;
  }
  if (previous) {
    await nextTick();
    if (dialogTrigger && typeof dialogTrigger.focus === 'function') dialogTrigger.focus();
    dialogTrigger = null;
  }
});

watch(modalLayerOpen, open => {
  if (open && !modalLayerLocked) {
    previousModalBodyOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    modalLayerLocked = true;
    return;
  }
  if (!open && modalLayerLocked) {
    document.body.style.overflow = previousModalBodyOverflow;
    modalLayerLocked = false;
  }
});

onMounted(() => {
  refreshStorage();
  window.addEventListener('keydown', onDialogKeydown);
});

onBeforeUnmount(() => {
  emit('detail-change', false);
  window.removeEventListener('keydown', onDialogKeydown);
  if (modalLayerLocked) document.body.style.overflow = previousModalBodyOverflow;
});
</script>

<style scoped>
.settings-page {
  container: settings / inline-size;
  width: 100%;
  min-width: 0;
  flex: 1;
  color: var(--md-on-surface);
  background: var(--md-surface-low);
}

.settings-topbar {
  position: sticky;
  top: 0;
  z-index: 20;
  background: var(--md-surface-low);
}

.settings-topbar-inner {
  width: 100%;
  max-width: 1480px;
  min-height: 104px;
  margin: auto;
  padding: 24px 28px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 16px;
}

.settings-topbar h1 {
  margin: 0;
  font-size: 26px;
  font-weight: 650;
  letter-spacing: -0.025em;
}

.settings-topbar p {
  margin: 6px 0 0;
  color: var(--md-on-surface-variant);
  font-size: 12px;
}

.settings-save-state {
  display: flex;
  flex: none;
  gap: 8px;
  align-items: center;
  padding: 12px 16px;
  border-radius: 24px;
  background: var(--md-surface);
  color: var(--md-on-surface-variant);
  font-size: 11px;
}

.settings-save-state svg {
  width: 18px;
  height: 18px;
  color: var(--md-primary);
}

.settings-import-status {
  position: sticky;
  top: calc(88px + env(safe-area-inset-top));
  z-index: 19;
}

.settings-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  grid-auto-flow: row dense;
  align-items: stretch;
  gap: 22px;
  max-width: 1480px;
  margin: auto;
  padding: 12px 28px 0;
}

.settings-card {
  min-width: 0;
  padding: 26px;
  border-radius: 34px;
  background: var(--md-surface);
  box-shadow: 0 6px 10px -8px color-mix(in oklab, var(--md-shadow-color-soft) 18%, transparent), 0 14px 30px -16px color-mix(in oklab, var(--md-shadow-color-soft) 24%, transparent);
}

.settings-card-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  min-height: 28px;
  margin-bottom: 24px;
}

.settings-card-head h2 {
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 10px;
  margin: 0;
  font-size: 17px;
  font-weight: 650;
}

.settings-card-head h2 svg {
  flex: none;
  width: 22px;
  height: 22px;
  color: var(--md-on-surface-variant);
}

.settings-card-head > span {
  color: var(--md-on-surface-variant);
  font-size: 11px;
}

.settings-note {
  margin: 8px 0 0;
  font-size: 11px;
  line-height: 1.7;
  color: var(--md-on-surface-variant);
}

.settings-appearance {
  grid-column: span 2;
  min-height: 294px;
  position: relative;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 20px;
}

.settings-appearance > .settings-detail-hint {
  align-self: stretch;
  z-index: 1;
  margin: auto 30px 0 0;
}

.settings-appearance .settings-book-stage {
  bottom: 64px;
}

.settings-appearance .settings-open-book {
  max-height: calc(100% - 40px);
}

.appearance-content {
  position: relative;
  z-index: 1;
  width: 57%;
}

.appearance-content h3 {
  font-size: 24px;
  line-height: 1.4;
  letter-spacing: -0.025em;
  margin: 27px 0 8px;
  font-weight: 650;
}

.appearance-content > p {
  margin: 0 0 28px;
  font-size: 12px;
  color: var(--md-on-surface-variant);
}

.appearance-content :deep(.md-segmented) {
  max-width: 340px;
}

.appearance-content :deep(.md-segmented-option) {
  min-height: 44px;
}

.settings-book-stage {
  position: absolute;
  inset: 0 0 0 63%;
  display: grid;
  place-items: center;
  border-radius: 80px 0 0 100px;
  background: var(--md-primary-container);
}

.settings-open-book {
  display: flex;
  width: 174px;
  height: 214px;
  transform: rotate(9deg);
  border: 5px solid color-mix(in oklab, var(--md-surface) 85%, var(--md-primary));
  border-radius: 8px 13px 13px 8px;
  background: var(--md-surface);
  box-shadow: 0 16px 24px -10px color-mix(in oklab, var(--md-shadow-color-soft) 40%, transparent);
}

.settings-book-page {
  position: relative;
  width: 50%;
  min-width: 0;
  padding: 21px 9px;
  font-family: 'Songti SC', 'STSong', serif;
}

.settings-book-page:first-child {
  border-right: 1px solid var(--md-outline-variant);
}

.settings-book-page b {
  display: block;
  margin-bottom: 12px;
  font-size: 10px;
  text-align: center;
}

.settings-book-page p {
  margin: 0 0 12px;
  font-size: 8px;
  line-height: 1.9;
}

.settings-book-page i {
  display: block;
  height: 3px;
  margin: 8px 0;
  border-radius: 2px;
  background: var(--md-outline-variant);
}

.settings-book-page i:nth-of-type(3n) {
  width: 78%;
}

.settings-book-page > span {
  position: absolute;
  bottom: 16px;
  left: 0;
  right: 0;
  text-align: center;
  font-size: 8px;
  color: var(--md-on-surface-variant);
}

.settings-reading {
  grid-column: span 2;
  container: reading / inline-size;
}

.settings-reading-controls {
  display: grid;
  grid-template-columns: 1.4fr 1.1fr 0.8fr;
  gap: 20px;
}

.settings-reading-controls.is-scrolling {
  grid-template-columns: 1fr;
}

.settings-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 10px;
  min-height: 20px;
  margin-bottom: 12px;
  font-size: 12px;
}

.settings-head b {
  color: var(--md-on-surface-variant);
  font-size: 10.5px;
  font-weight: 500;
}

.settings-block {
  min-width: 0;
}

.settings-reading :deep(.md-segmented-option) {
  min-height: 44px;
  padding-inline: 6px;
  font-size: 11px;
}

.settings-reading-bottom {
  display: grid;
  grid-template-columns: 1fr 1fr;
  align-items: center;
  gap: 32px;
  margin-top: 24px;
  padding-top: 20px;
  border-top: 1px solid color-mix(in oklab, var(--md-outline-variant) 65%, transparent);
}

.settings-reading-bottom .settings-head b {
  color: var(--md-primary);
  font-size: 12px;
  font-variant-numeric: tabular-nums;
}

.font-size-control {
  display: flex;
  align-items: center;
  gap: 12px;
}

.settings-icon-button {
  display: grid;
  place-items: center;
  flex: none;
  width: 44px;
  height: 44px;
  padding: 0;
  border: 0;
  border-radius: 50%;
  color: var(--md-on-surface-variant);
  background: transparent;
  cursor: pointer;
}

.settings-icon-button svg {
  width: 20px;
  height: 20px;
}

.settings-range {
  width: 100%;
  min-width: 0;
  flex: 1;
}

.settings-value-copy {
  display: block;
  min-width: 0;
}

.settings-value-copy b {
  display: block;
  font-size: 13px;
  font-weight: 550;
}

.settings-value-copy span {
  display: block;
  margin-top: 6px;
  color: var(--md-on-surface-variant);
  font-size: 11px;
  line-height: 1.6;
}

.settings-text-button, .settings-tonal-button {
  display: inline-flex;
  justify-content: center;
  align-items: center;
  gap: 6px;
  min-height: 44px;
  padding: 8px 12px;
  border: 0;
  border-radius: 22px;
  background: transparent;
  color: var(--md-primary);
  font-size: 12px;
  font-weight: 550;
  cursor: pointer;
}

.settings-text-button svg {
  width: 17px;
  height: 17px;
}

.settings-tonal-button {
  padding-inline: 18px;
  color: var(--md-on-secondary-container);
  background: var(--md-secondary-container);
}

.settings-card-actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-top: 16px;
}

.settings-storage .settings-card-head {
  margin-bottom: 12px;
}

.storage-number {
  display: block;
  font-size: 34px;
  font-weight: 700;
  letter-spacing: -0.03em;
  line-height: 1.3;
  font-variant-numeric: tabular-nums;
}

.storage-stack, .storage-bar {
  display: flex;
  gap: 3px;
  height: 11px;
  margin: 22px 0 18px;
  overflow: hidden;
  border-radius: 12px;
  background: var(--md-surface-high);
}

.storage-seg {
  height: 100%;
  flex-shrink: 1;
}

.storage-seg-app, .storage-bar i {
  background: var(--md-primary);
}

.storage-seg-other {
  background: color-mix(in oklab, var(--md-primary) 35%, var(--md-surface));
}

.storage-seg-free {
  background: var(--md-surface-high);
}

.storage-bar i {
  display: block;
  height: 100%;
  border-radius: inherit;
}

.storage-legend {
  display: grid;
  gap: 12px;
}

.storage-legend > div {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  font-size: 11px;
  color: var(--md-on-surface-variant);
}

.storage-legend b {
  margin-left: auto;
  color: var(--md-on-surface);
  font-weight: 550;
  font-variant-numeric: tabular-nums;
}

.storage-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex: none;
}

.settings-about, .settings-import, .settings-debug {
  min-height: 240px;
}

.settings-card-head > .settings-badge {
  flex: none;
  border-radius: 16px;
  padding: 6px 9px;
  font-size: 10px;
  background: var(--md-primary-container);
  color: var(--md-on-primary-container);
}

.about-version {
  display: flex;
  align-items: center;
  gap: 12px;
}

.about-version > img {
  width: 44px;
  height: 44px;
  flex: none;
  border-radius: 13px;
}

.about-version h3 {
  margin: 0;
  font-size: 19px;
  letter-spacing: -0.025em;
  font-weight: 650;
}

.about-version h3 span {
  font-size: 12px;
  font-weight: 500;
  white-space: nowrap;
}

.about-version .settings-note {
  margin-top: 5px;
}

.about-repository {
  margin-top: 4px;
}

.about-log-new {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--md-primary);
}

.settings-debug-copy {
  margin: 0;
  font-size: 13px;
  font-weight: 550;
}

.settings-debug > .settings-text-button {
  margin-top: 14px;
  padding-left: 0;
}

.settings-import > .settings-note {
  margin-top: 18px;
}

.settings-footer {
  display: flex;
  justify-content: space-between;
  gap: 20px;
  max-width: 1480px;
  margin: auto;
  padding: 24px 32px 36px;
  font-size: 11px;
  line-height: 1.7;
  color: var(--md-on-surface-variant);
}

.settings-page button:disabled {
  opacity: 0.42;
  cursor: default;
}

.settings-page button:focus-visible, .settings-page summary:focus-visible {
  outline: 2px solid var(--md-primary);
  outline-offset: 3px;
}

.storage-stack.is-revealing .storage-seg {
  transform-origin: left;
  animation: settings-storage-grow 280ms var(--md-ease-emphasized) both;
}

.storage-stack.is-revealing .storage-seg-other {
  animation-delay: 90ms;
}

.storage-stack.is-revealing .storage-seg-free {
  animation-delay: 180ms;
}

.storage-bar.is-revealing i {
  transform-origin: left;
  animation: settings-storage-grow 280ms var(--md-ease-emphasized) both;
}

@keyframes settings-storage-grow {
  from {
    transform: scaleX(0);
  }

  to {
    transform: scaleX(1);
  }
}

@container reading (max-width: 680px) {
  .settings-reading-controls {
    grid-template-columns: 1fr 1fr;
  }

  .settings-reading-controls > .settings-block:first-child {
    grid-column: 1 / -1;
  }

  .settings-reading-bottom {
    gap: 20px;
  }
}

@container settings (max-width: 1039px) {
  .settings-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 18px;
  }

  .settings-card {
    padding: 24px;
  }

  .settings-about {
    min-height: 0;
  }
}

@container settings (max-width: 599px) {
  .settings-grid {
    grid-template-columns: minmax(0, 1fr);
    gap: 16px;
    padding: 8px 16px 0;
  }

  .settings-card {
    padding: 22px;
    border-radius: 28px;
  }

  .settings-appearance, .settings-reading, .settings-storage, .settings-about {
    grid-column: auto;
    grid-row: auto;
  }

  .settings-topbar-inner {
    min-height: 88px;
    padding: 18px 16px;
  }

  .settings-topbar h1 {
    font-size: 22px;
  }

  .settings-topbar p {
    font-size: 11px;
  }

  .settings-save-state {
    padding: 10px;
  }

  .settings-save-state span {
    display: none;
  }

  .settings-card-head {
    margin-bottom: 22px;
  }

  .settings-card-head h2 {
    font-size: 17px;
  }

  .settings-card-head > span {
    font-size: 10px;
  }

  .settings-appearance {
    min-height: 266px;
  }

  .appearance-content {
    width: 66%;
  }

  .appearance-content h3 {
    margin-top: 25px;
    font-size: 21px;
  }

  .appearance-content > p {
    font-size: 10px;
    margin-bottom: 24px;
  }

  .appearance-content :deep(.md-segmented-option) {
    padding-inline: 4px;
    font-size: 11px;
  }

  .settings-book-stage {
    left: 71%;
    border-radius: 65px 0 0 80px;
  }

  .settings-open-book {
    width: 88px;
    height: 158px;
    transform: rotate(9deg);
  }

  .settings-book-page {
    padding: 18px 5px;
  }

  .settings-book-page b {
    font-size: 7px;
  }

  .settings-book-page p {
    font-size: 6px;
  }

  .settings-book-page i {
    height: 2px;
    margin-block: 7px;
  }

  .settings-reading-controls, .settings-reading-bottom {
    grid-template-columns: minmax(0, 1fr);
  }

  .settings-reading-controls > .settings-block:first-child {
    grid-column: auto;
  }

  .settings-reading-bottom {
    gap: 20px;
  }

  .settings-about, .settings-import, .settings-debug {
    min-height: 0;
  }

  .settings-footer {
    padding: 24px 20px 32px;
    font-size: 10px;
  }
}

@media (hover: hover) and (pointer: fine) {
  .settings-icon-button:not(:disabled):hover, .settings-text-button:not(:disabled):hover {
    background: var(--md-surface-container);
  }

  .settings-tonal-button:hover {
    background: color-mix(in oklab, var(--md-secondary-container) 85%, var(--md-primary));
  }
}

.settings-dialog-layer {
  position: fixed;
  inset: 0;
  z-index: 70;
  padding: 24px;
  background: color-mix(in oklab, var(--md-shadow-color) 38%, transparent);
  display: grid;
  place-items: center;
}

.settings-dialog {
  width: min(420px, 100%);
  padding: 24px;
  border-radius: 28px;
  background: var(--md-surface-container);
  color: var(--md-on-surface);
  box-shadow: 0 24px 64px -24px color-mix(in oklab, var(--md-shadow-color-soft) 56%, transparent);
}

.settings-dialog-icon {
  width: 44px;
  height: 44px;
  border-radius: 14px;
  display: grid;
  place-items: center;
  background: var(--md-secondary-container);
  color: var(--md-on-secondary-container);
}

.settings-dialog-icon svg {
  width: 21px;
  height: 21px;
}

.settings-dialog h3 {
  margin: 18px 0 8px;
  font-size: 17px;
  font-weight: 650;
}

.settings-dialog p {
  margin: 0;
  color: var(--md-on-surface-variant);
  font-size: 13px;
  line-height: 1.65;
}

.settings-dialog-actions {
  margin-top: 24px;
  display: flex;
  justify-content: flex-end;
  gap: 10px;
}

.settings-dialog-button {
  min-height: 44px;
  padding: 0 20px;
  border: 0;
  border-radius: 22px;
  font-size: 13px;
  font-weight: 620;
  cursor: pointer;
}

.settings-dialog-button.is-secondary {
  background: transparent;
  color: var(--md-primary);
}

.settings-dialog-button.is-secondary:hover:not(:disabled) {
  background: var(--md-surface-high);
}

.settings-dialog-button.is-primary {
  background: var(--md-primary);
  color: var(--md-on-primary);
}

.settings-dialog-button:disabled {
  opacity: 0.56;
  cursor: default;
}

.settings-dialog-enter-active,
.settings-dialog-leave-active {
  transition: opacity var(--md-duration-short) var(--md-ease-emphasized);
}

.settings-dialog-enter-active .settings-dialog,
.settings-dialog-leave-active .settings-dialog {
  transition: transform var(--md-duration-short) var(--md-ease-emphasized),
    opacity var(--md-duration-short) var(--md-ease-emphasized);
}

.settings-dialog-enter,
.settings-dialog-leave-to {
  opacity: 0;
}

.settings-dialog-enter .settings-dialog,
.settings-dialog-leave-to .settings-dialog {
  opacity: 0;
  transform: translateY(10px) scale(0.98);
}

.settings-dialog-enter-to,
.settings-dialog-leave-from {
  opacity: 1;
}

@media (max-width: 899px) {
  .settings-dialog-layer {
    padding: 16px;
    align-items: end;
  }

  .settings-dialog {
    border-radius: 28px 28px 20px 20px;
  }
}

@media (prefers-reduced-motion: reduce) {
  .storage-stack.is-revealing .storage-seg, .storage-bar.is-revealing i {
    animation: none;
  }

  .settings-dialog-enter-active, .settings-dialog-leave-active, .settings-dialog-enter-active .settings-dialog, .settings-dialog-leave-active .settings-dialog {
    transition: none;
  }
}

/* 二级设置使用整页分组列表，首页卡片保留快捷控件。 */

.settings-card {
  position: relative;
  isolation: isolate;
}

.settings-card > .settings-card-open {
  position: absolute;
  inset: 0;
  z-index: 0;
  width: 100%;
  height: 100%;
  padding: 0;
  border: 0;
  border-radius: inherit;
  background: transparent;
  cursor: pointer;
}

.settings-card-open-icon {
  position: absolute;
  right: 24px;
  bottom: 24px;
  display: grid;
  place-items: center;
  color: var(--md-on-surface-variant);
}

.settings-card > :not(.settings-card-open) {
  pointer-events: none;
}

.settings-card :deep(.md-segmented), .settings-card :deep(.md-range), .settings-card :deep(.theme-swatch-grid), .settings-card button:not(.settings-card-open) {
  position: relative;
  z-index: 2;
  pointer-events: auto;
}

.settings-card :deep(button), .settings-card :deep(input) {
  pointer-events: auto;
}

.settings-page .settings-card-open:focus-visible {
  outline-offset: -4px;
}

.settings-detail-hint {
  margin: 20px 30px 0 0;
  min-height: 24px;
  color: var(--md-primary);
  font-size: 12px;
}

.settings-back-button {
  display: grid;
  place-items: center;
  flex: none;
  width: 56px;
  height: 56px;
  border-radius: 50%;
  background: var(--md-surface);
  color: var(--md-on-surface);
  cursor: pointer;
}

.settings-back-button svg {
  width: 29px;
  height: 29px;
}

.has-detail .settings-topbar-inner {
  justify-content: flex-start;
  max-width: 1036px;
  gap: 20px;
}

.has-detail .settings-save-state {
  margin-left: auto;
  background: transparent;
}

.settings-detail {
  max-width: 1036px;
  margin: auto;
  padding: 8px 28px 16px;
}

.has-detail .settings-footer {
  max-width: 1036px;
}

.settings-detail-hero {
  min-width: 0;
  padding: 30px;
  margin-bottom: 30px;
  overflow: hidden;
  border-radius: 34px;
  background: var(--md-surface);
}

.settings-surface-hero {
  display: grid;
  place-items: center;
  min-height: 324px;
}

.settings-detail-group {
  margin-bottom: 28px;
}

.settings-detail-group > h2 {
  display: flex;
  align-items: center;
  gap: 11px;
  margin: 0 18px 14px;
  color: var(--md-on-surface-variant);
  font-size: 16px;
  font-weight: 650;
}

.settings-detail-group > h2 svg {
  width: 21px;
  height: 21px;
}

.settings-list {
  min-width: 0;
  border-radius: 28px;
  overflow: hidden;
  background: var(--md-surface);
}

.settings-list > :not(:first-child) {
  border-top: 1px solid color-mix(in oklab, var(--md-outline-variant) 65%, transparent);
}

.settings-list-row {
  position: relative;
  display: flex;
  align-items: center;
  gap: 17px;
  width: 100%;
  min-height: 74px;
  padding: 18px 24px;
  border: 0;
  background: transparent;
  color: var(--md-on-surface);
  text-align: left;
}

button.settings-list-row {
  cursor: pointer;
}

.settings-list-row .settings-value-copy {
  flex: 1;
}

.settings-list-row .settings-value-copy b {
  font-size: 16px;
  font-weight: 500;
}

.settings-list-row .settings-value-copy span {
  font-size: 12px;
}

.settings-list-row > svg {
  flex: none;
  width: 22px;
  height: 22px;
  color: var(--md-on-surface-variant);
}

.settings-list-row > .settings-row-check {
  width: 27px;
  height: 27px;
  color: var(--md-primary);
}

.settings-row-value {
  flex: none;
  margin-left: auto;
  font-size: 13px;
  font-weight: 500;
  color: var(--md-on-surface-variant);
  font-variant-numeric: tabular-nums;
}

.settings-row-icon {
  display: grid;
  place-items: center;
  flex: none;
  width: 40px;
  height: 40px;
  border-radius: 13px;
  background: var(--md-surface-container);
  color: var(--md-on-surface-variant);
}

.settings-row-icon svg {
  width: 22px;
  height: 22px;
}

.settings-detail-note {
  margin: 12px 20px 0;
  font-size: 12px;
  line-height: 1.7;
  color: var(--md-on-surface-variant);
}

.settings-quiet-note {
  margin: 28px 0;
  text-align: center;
  font-size: 12px;
  color: var(--md-on-surface-variant);
}

.settings-surface-row {
  min-height: 102px;
}

.settings-hero-copy {
  min-width: 0;
  max-width: 350px;
}

.settings-hero-copy h2 {
  margin: 21px 0 10px;
  font-size: 25px;
  font-weight: 650;
  letter-spacing: -0.025em;
}

.settings-hero-copy p {
  color: var(--md-on-surface-variant);
  font-size: 12px;
  line-height: 1.7;
}

.settings-badge {
  display: inline-block;
  padding: 7px 12px;
  border-radius: 15px;
  background: var(--md-primary-container);
  color: var(--md-on-primary-container);
  font-size: 11px;
}

.settings-reading-hero {
  display: flex;
  justify-content: center;
  align-items: center;
  gap: 55px;
  min-height: 216px;
}

.settings-reading-hero .settings-book-stage {
  position: static;
  display: block;
  flex: none;
  background: transparent;
  border-radius: 0;
}

.settings-reading-hero .settings-open-book {
  width: 145px;
  height: 164px;
  border-width: 4px;
  transform: rotate(7deg);
}

.settings-reading-hero .settings-book-page {
  padding: 16px 7px;
}

.settings-reading-hero .settings-book-page b {
  font-size: 8px;
}

.settings-reading-hero .settings-book-page p {
  font-size: 6px;
  margin-block: 8px;
}

.settings-reading-hero .settings-book-page i {
  height: 2px;
  margin-block: 6px;
}

.settings-reading-hero .settings-book-page > span {
  bottom: 9px;
  font-size: 6px;
}

.settings-reading-hero .settings-hero-copy h2 {
  font-size: 22px;
}

.settings-detail-font {
  padding: 18px 24px;
}

.settings-detail-font .settings-head {
  align-items: center;
  margin-bottom: 12px;
  font-size: 16px;
}

.settings-detail-font .settings-head b {
  font-size: 14px;
  color: var(--md-primary);
  font-variant-numeric: tabular-nums;
}

.settings-detail .settings-list-row > .settings-text-button {
  flex: none;
}

.settings-storage-hero {
  padding: 28px 36px;
}

.settings-storage-hero-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  color: var(--md-on-surface-variant);
  font-size: 13px;
}

.settings-storage-hero .storage-number {
  font-size: 42px;
}

.settings-storage-hero .storage-legend {
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 24px;
}

.settings-about-hero {
  padding: 32px;
  text-align: center;
}

.settings-about-hero > img {
  display: block;
  width: 70px;
  height: 70px;
  margin: auto;
  border-radius: 21px;
}

.settings-about-hero > h2 {
  margin: 16px 0 10px;
  font-size: 28px;
  letter-spacing: 0.025em;
}

.settings-about-hero > p:not(.settings-note) {
  margin: 22px 0 10px;
  font-size: 17px;
}

.settings-about-hero .settings-note {
  font-size: 12px;
  line-height: 1.8;
}

.settings-import-hero {
  min-height: 334px;
  text-align: center;
}

.settings-import-diagram {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 28px;
  margin-top: 10px;
}

.settings-import-diagram > svg {
  color: var(--md-outline);
}

.settings-import-folder {
  display: grid;
  place-items: center;
  width: 104px;
  height: 104px;
  border-radius: 30px;
  background: var(--md-primary-container);
  color: var(--md-primary);
}

.settings-import-folder svg {
  width: 65px;
  height: 65px;
}

.settings-import-books {
  display: flex;
  align-items: flex-end;
  gap: 8px;
  height: 104px;
}

.settings-import-books i {
  position: relative;
  width: 47px;
  height: 80px;
  border-radius: 7px;
  border-left: 5px solid var(--md-primary);
  background: var(--md-secondary-container);
}

.settings-import-books i:nth-child(2) {
  height: 102px;
  background: var(--md-primary-container);
}

.settings-import-books i:nth-child(3) {
  height: 91px;
  background: var(--md-tertiary-container);
}

.settings-import-books i::before {
  content: '';
  position: absolute;
  top: 15px;
  left: 7px;
  right: 7px;
  height: 5px;
  border-radius: 3px;
  background: var(--md-surface);
}

.settings-import-hero > h2 {
  margin: 29px 0 10px;
  font-size: 24px;
  font-weight: 650;
}

.settings-import-hero > p {
  font-size: 12px;
  color: var(--md-on-surface-variant);
}

@media (hover: hover) and (pointer: fine) {
  button.settings-list-row:hover {
    background: color-mix(in oklab, var(--md-primary) 4%, transparent);
  }

  .settings-back-button:hover {
    background: var(--md-surface-high);
  }
}

@container settings (max-width: 699px) {
  .has-detail .settings-topbar-inner {
    min-height: 92px;
    padding: 18px 16px;
    gap: 15px;
  }

  .settings-back-button {
    width: 46px;
    height: 46px;
  }

  .settings-back-button svg {
    width: 25px;
    height: 25px;
  }

  .settings-detail {
    padding: 8px 16px calc(24px + env(safe-area-inset-bottom));
  }

  .settings-detail-hero {
    padding: 26px 20px;
    border-radius: 28px;
  }

  .settings-hero-copy h2 {
    font-size: 20px;
  }

  .settings-reading-hero {
    gap: 22px;
  }

  .settings-reading-hero .settings-open-book {
    width: 105px;
    height: 150px;
  }

  .settings-reading-hero .settings-hero-copy {
    max-width: 170px;
  }

  .settings-reading-hero .settings-hero-copy h2 {
    font-size: 19px;
  }

  .settings-detail-group > h2 {
    font-size: 15px;
  }

  .settings-list-row {
    gap: 12px;
    padding: 18px 20px;
  }

  .settings-list-row .settings-value-copy b {
    font-size: 15px;
  }

  .settings-list-row .settings-value-copy span {
    font-size: 11px;
  }

  .settings-row-value {
    font-size: 12px;
  }

  .settings-storage-hero .storage-legend {
    grid-template-columns: 1fr;
    gap: 12px;
  }

  .settings-detail-font {
    padding: 18px 20px;
  }

  .settings-import-diagram {
    gap: 20px;
  }

  .settings-import-folder {
    width: 80px;
    height: 80px;
    border-radius: 24px;
  }

  .settings-import-folder svg {
    width: 50px;
    height: 50px;
  }

  .settings-import-books {
    height: 90px;
    gap: 6px;
  }

  .settings-import-books i {
    width: 35px;
  }

  .settings-import-books i:nth-child(2) {
    height: 90px;
  }

  .settings-import-hero > h2 {
    font-size: 22px;
  }
}

.settings-color-name {
  margin-left: auto;
  font-size: 12px;
  font-weight: 500;
}

.settings-color-strip {
  container: theme-palette / inline-size;
  padding: 12px 20px;
}

@container settings (max-width: 599px) {
  .settings-color-strip {
    padding-inline: 12px;
  }
}
</style>
