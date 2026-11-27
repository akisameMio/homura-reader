<template>
  <div ref="pageRef" class="settings-page" :class="{ 'md-bottom-nav-space': isCompact }" :inert="!!activeSection">
    <header
      class="settings-topbar md-topbar-fade"
      :style="isCompact ? { paddingTop: 'env(safe-area-inset-top)' } : null"
    >
      <div class="settings-topbar-inner">
        <div class="settings-topbar-title">
          <Transition name="md-topbar-title" appear>
            <h1 class="md-topbar-title">{{ t('设置') }}</h1>
          </Transition>
        </div>
      </div>
    </header>
    <div v-if="isCompact && $slots.status" class="settings-import-status">
      <slot name="status"></slot>
    </div>
    <div class="settings-grid">
      <section class="settings-card settings-appearance" aria-labelledby="settings-appearance-title">
        <div class="appearance-content">
          <div class="settings-card-head">
            <h2 id="settings-appearance-title">
              <MdIcon name="palette" />
              {{ t('外观') }}
            </h2>
            <span>{{ t(themeLabel) }}</span>
          </div>
          <p class="settings-control-label">{{ t('表面模式') }}</p>
          <MdSegmentedControl
            :model-value="theme.surfaceMode"
            :options="surfaceOptions"
            :aria-label="t('表面模式')"
            @update:model-value="setSurfaceMode"
          />
        </div>
        <div class="settings-book-stage" aria-hidden="true">
          <div class="settings-open-book">
            <div class="settings-book-page">
              <i v-for="line in 7" :key="line"></i>
              <span>12</span>
            </div>
            <div class="settings-book-page">
              <i v-for="line in 7" :key="line"></i>
              <span>13</span>
            </div>
          </div>
        </div>
        <button
          type="button"
          class="settings-card-open"
          @click="openSection('appearance')"
        >
          <span>{{ t('更多外观设置') }}</span>
          <MdIcon name="chevron_right" :size="20" />
        </button>
      </section>
      <section class="settings-card settings-reading" aria-labelledby="settings-reading-title">
        <div class="settings-card-head">
          <h2 id="settings-reading-title">
            <MdIcon name="auto_stories" />
            {{ t('阅读默认值') }}
          </h2>
          <span>{{ t('首次打开作品时采用') }}</span>
        </div>
        <div>
          <div class="settings-reading-controls" :class="{ 'has-disabled-controls': isScrollDefault }">
            <div class="settings-block">
              <p class="settings-control-label">{{ t('翻页方式') }}</p>
              <MdSegmentedControl
                :model-value="settings.transitionStyle"
                :options="transitionOptions"
                :aria-label="t('翻页方式')"
                @update:model-value="settings.setTransitionStyle"
              />
            </div>
            <div class="settings-block settings-paged-block">
              <p class="settings-control-label">{{ t('阅读方向') }}</p>
              <MdSegmentedControl
                :model-value="readerDefaults.pagedDirection"
                :options="directionOptions"
                :disabled="isScrollDefault"
                :aria-label="t('阅读方向')"
                @update:model-value="setDirection"
              />
            </div>
            <div class="settings-block settings-paged-block">
              <p class="settings-control-label">{{ t('跨页布局') }}</p>
              <MdSegmentedControl
                :model-value="readerDefaults.spread"
                :options="spreadOptions"
                :disabled="isScrollDefault"
                :aria-label="t('跨页布局')"
                @update:model-value="setSpread"
              />
            </div>
          </div>
          <div class="settings-scroll-note" :class="{ 'is-expanded': isScrollDefault }" :aria-hidden="!isScrollDefault">
            <div class="settings-scroll-note-clip">
              <p>{{ t('条漫模式沿用上次的分页方向与跨页布局，切回分页后生效。') }}</p>
            </div>
          </div>
        </div>
        <button
          type="button"
          class="settings-card-open"
          @click="openSection('reading')"
        >
          <span>{{ t('更多阅读设置') }}</span>
          <MdIcon name="chevron_right" :size="20" />
        </button>
      </section>
      <section class="settings-card settings-storage" aria-labelledby="settings-storage-title">
        <div class="settings-card-head">
          <h2 id="settings-storage-title">
            <MdIcon name="database" />
            {{ t('存储与数据') }}
          </h2>
          <MdIconButton
            type="button"
            class="settings-icon-button"
            :title="t('刷新存储用量')"
            :aria-label="t('刷新存储用量')"
            :disabled="storageLoading"
            @click="refreshStorage"
          >
            <MdIcon name="update" />
          </MdIconButton>
        </div>
        <template v-if="diskSegments">
          <div class="storage-summary">
            <div>
              <p class="settings-note">{{ t('HOMURA 占用') }}</p>
              <strong class="storage-number">{{ formatBytes(diskSegments.appBytes) }}</strong>
            </div>
            <p class="settings-note">{{ t('共 {0}', { 0: storageTotalText }) }}</p>
          </div>
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
              <span>{{ t('其他应用') }}</span>
              <b>{{ formatBytes(diskSegments.otherBytes) }}</b>
            </div>
            <div>
              <i class="storage-dot storage-seg-free"></i>
              <span>{{ t('可用空间') }}</span>
              <b>{{ formatBytes(diskSegments.freeBytes) }}</b>
            </div>
          </div>
        </template>
        <template v-else>
          <div class="storage-summary">
            <div>
              <p class="settings-note">{{ nativeStorageEnabled ? t('WebView 本地数据') : t('浏览器本地数据') }}</p>
              <strong class="storage-number">{{ storageUsageText }}</strong>
            </div>
            <p class="settings-note">{{ storageQuotaText }}</p>
          </div>
          <div
            class="storage-bar"
            :class="{ 'is-revealing': storageRevealing }"
            role="progressbar"
            :aria-label="t('本地存储用量')"
            aria-valuemin="0"
            aria-valuemax="100"
            :aria-valuenow="storagePercent"
          >
            <i :style="{ width: storageBarWidth }"></i>
          </div>
          <p v-if="nativeStorageEnabled" class="settings-note">{{ t('应用内存档保存在此设备，容量受可用空间限制。') }}</p>
        </template>
        <button
          type="button"
          class="settings-card-open"
          @click="openSection('storage')"
        >
          <span>{{ t('管理本机数据') }}</span>
          <MdIcon name="chevron_right" :size="20" />
        </button>
      </section>
      <section class="settings-card settings-logs" aria-labelledby="settings-logs-title">
        <div class="settings-card-head">
          <h2 id="settings-logs-title">
            <MdIcon name="history" />
            {{ t('运行日志') }}
          </h2>
        </div>
        <MdSwitch
          :model-value="settings.runtimeLogCapture"
          :title="t('记录应用运行期间的日志')"
          @update:model-value="settings.setRuntimeLogCapture"
        >
          <span class="settings-value-copy">
            <b>{{ t('日志捕获') }}</b>
          </span>
        </MdSwitch>
        <div class="settings-log-summary">
          <span>{{ logTotalText }}</span>
          <span>{{ t('最近 300 条留在本机') }}</span>
        </div>
        <button
          type="button"
          class="settings-card-open"
          @click="openSection('logs')"
        >
          <span>{{ t('查看运行日志') }}</span>
          <MdIcon name="chevron_right" :size="20" />
        </button>
      </section>
      <section class="settings-card settings-sync" aria-labelledby="settings-sync-title">
        <div class="settings-card-head">
          <h2 id="settings-sync-title"><MdIcon name="cloud" />{{ t('WebDAV 同步') }}</h2>
          <span class="settings-badge" :class="{ 'is-muted': !sync.config.url || !sync.enabled }">{{ syncStatusBadge }}</span>
        </div>
        <p class="settings-note">{{ syncCardNote }}</p>
        <button
          type="button"
          class="settings-card-open"
          @click="openSection('sync')"
        >
          <span>{{ t('配置同步连接') }}</span>
          <MdIcon name="chevron_right" :size="20" />
        </button>
      </section>
      <section class="settings-card settings-import" aria-labelledby="settings-import-title">
        <div class="settings-card-head">
          <h2 id="settings-import-title">
            <MdIcon name="upload_file" />
            {{ t('导入偏好') }}
          </h2>
        </div>
        <MdSwitch
          :model-value="settings.importCollectionPrompt"
          :title="t('导入多本作品时询问是否创建书库')"
          @update:model-value="settings.setImportCollectionPrompt"
        >
          <span class="settings-value-copy">
            <b>{{ t('导入时询问创建书库') }}</b>
          </span>
        </MdSwitch>
        <button
          type="button"
          class="settings-card-open"
          @click="openSection('import')"
        >
          <span>{{ t('打开导入偏好') }}</span>
          <MdIcon name="chevron_right" :size="20" />
        </button>
      </section>
      <section class="settings-card settings-language" aria-labelledby="settings-language-title">
        <div class="settings-card-head">
          <h2 id="settings-language-title">
            <MdIcon name="language" />
            {{ t('语言') }}
          </h2>
        </div>
        <SettingsSelectRow
          :label="t('界面语言')"
          :model-value="locale"
          :options="localeOptions"
          @update:model-value="setLocale"
        />
        <p class="settings-note">{{ t('更改即时应用到整个应用，也会自动保存。') }}</p>
      </section>
      <section class="settings-card settings-debug" aria-labelledby="settings-debug-title">
        <div class="settings-card-head">
          <h2 id="settings-debug-title">
            <MdIcon name="science" />
            {{ t('调试') }}
          </h2>
        </div>
        <p class="settings-note">{{ t('自动检查更新、全屏入口与示例内容。') }}</p>
        <button
          type="button"
          class="settings-card-open"
          @click="openSection('debug')"
        >
          <span>{{ t('打开调试设置') }}</span>
          <MdIcon name="chevron_right" :size="20" />
        </button>
      </section>
      <section class="settings-card settings-about" aria-labelledby="settings-about-title">
        <div class="settings-card-head">
          <h2 id="settings-about-title">
            <MdIcon name="info" />
            {{ t('关于 HOMURA') }}
          </h2>
          <span class="settings-badge">{{ t('MIT 开源') }}</span>
        </div>
        <div class="settings-about-body">
          <div class="about-version">
            <img :src="logoUrl" :alt="t('HOMURA 应用图标')" />
            <div>
              <h3>
                HOMURA
                <span>{{ appVersion }}</span>
              </h3>
              <p class="settings-note">{{ t('本地优先的 ACGN 阅读器') }}</p>
            </div>
          </div>
          <div class="settings-card-actions">
            <button type="button" class="settings-tonal-button" @click="updates.handlePrimaryUpdateAction">{{ hasPendingInstall ? t('继续安装') : t('检查更新') }}</button>
            <button type="button" class="settings-text-button" @click="updates.openChangelog">
              {{ t('更新日志') }}
              <i v-if="hasNewRelease" class="about-log-new" :aria-label="t('有新版本')"></i>
            </button>
            <button type="button" class="settings-text-button" @click="openRepository">
              {{ t('开源仓库') }}
              <MdIcon name="open_in_new" />
            </button>
          </div>
        </div>
        <p v-if="aboutLinkError" class="settings-note" role="alert">{{ aboutLinkError }}</p>
        <button
          type="button"
          class="settings-card-open"
          @click="openSection('about')"
        >
          <span>{{ t('打开关于 HOMURA') }}</span>
          <MdIcon name="chevron_right" :size="20" />
        </button>
      </section>
    </div>
    <footer class="settings-footer">
      <span>{{ t('作品保存在本机，同步由你选择。') }}</span>
      <span>HOMURA · ACGN GO</span>
    </footer>
  </div>
  <Teleport to="body">
    <section
      v-if="activeSection"
      class="settings-transition-layer"
      :class="{ 'is-preparing': preparingDetail, 'is-settled': detailSettled }"
      :style="detailInsets"
      :aria-label="t(sectionTitles[activeSection])"
    >
      <div ref="clipRef" class="settings-transition-clip">
        <div class="settings-transition-surround" aria-hidden="true"></div>
        <div ref="surfaceRef" class="settings-transition-surface" aria-hidden="true"></div>
        <div ref="detailRef" class="settings-page has-detail" :inert="returningDetail">
          <header
            class="settings-topbar"
            :style="isCompact ? { paddingTop: 'env(safe-area-inset-top)' } : null"
          >
            <div class="settings-topbar-inner" :class="{ 'is-log-searching': activeSection === 'logs' && logSearchOpen }">
              <MdIconButton
                ref="backButtonRef"
                type="button"
                class="settings-back-button"
                :aria-label="t('返回设置')"
                @click="showPreviousSection"
              >
                <MdIcon name="chevron_left" />
              </MdIconButton>
              <div class="settings-topbar-title">
                <h1 class="md-topbar-title">{{ t(sectionTitles[activeSection]) }}</h1>
              </div>
              <div v-if="activeSection === 'logs'" class="settings-topbar-actions">
                <div v-if="logSearchOpen" class="settings-log-search" role="search">
                  <MdIcon name="search" :size="19" />
                  <input
                    ref="logSearchInputRef"
                    v-model="logQuery"
                    type="text"
                    inputmode="search"
                    enterkeyhint="search"
                    autocomplete="off"
                    spellcheck="false"
                    :placeholder="t('搜索日志')"
                    :aria-label="t('搜索日志')"
                    @keydown.esc.stop="closeLogSearch"
                  />
                  <MdIconButton
                    type="button"
                    class="settings-log-search-close"
                    :aria-label="t('关闭搜索')"
                    :title="t('关闭搜索')"
                    @click="closeLogSearch"
                  >
                    <MdIcon name="close" :size="18" />
                  </MdIconButton>
                </div>
                <div v-else class="settings-log-actions">
                  <MdIconButton
                    type="button"
                    preserve-user-activation
                    class="settings-log-action"
                    :aria-label="t('搜索日志')"
                    :title="t('搜索日志')"
                    @click="openLogSearch"
                  >
                    <MdIcon name="search" :size="22" />
                  </MdIconButton>
                  <MdIconButton
                    type="button"
                    preserve-user-activation
                    class="settings-log-action"
                    :aria-label="t('导出日志')"
                    :title="t('导出日志')"
                    :disabled="!filteredLogs.length || logExporting"
                    @click="exportLogs"
                  >
                    <MdIcon name="ios_share" :size="22" />
                  </MdIconButton>
                </div>
              </div>
            </div>
          </header>
          <div class="settings-detail">
            <template v-if="activeSection === 'appearance'">
              <div class="settings-detail-hero settings-surface-hero">
                <div class="settings-surface-hero-preview">
                  <SettingsInterfacePreview />
                </div>
                <div class="settings-hero-copy">
                  <span class="settings-badge">{{ t('排版预览') }}</span>
                  <h2>{{ t('外观设置') }}</h2>
                  <p>{{ t('更改即时应用到整个应用，也会自动保存。') }}</p>
                </div>
              </div>
              <section class="settings-detail-group" aria-labelledby="settings-surface-heading">
                <h2 id="settings-surface-heading">
                  <MdIcon name="light_mode" />
                  {{ t('表面模式') }}
                </h2>
                <div class="settings-list" role="group" :aria-label="t('表面模式')">
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
                      <b>{{ t(option.label) }}</b>
                    </span>
                    <MdIcon v-if="theme.surfaceMode === option.value" name="check" class="settings-row-check" />
                  </button>
                </div>
              </section>
              <section class="settings-detail-group" aria-labelledby="settings-black-heading">
                <h2 id="settings-black-heading">
                  <MdIcon name="contrast" />
                  {{ t('纯黑模式') }}
                  <MdInfoHint :label="t('纯黑模式')">{{ t('仅在夜间模式下生效，跟随系统时也会自动应用。') }}</MdInfoHint>
                </h2>
                <div class="settings-list" role="group" :aria-label="t('纯黑模式')">
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
                      <b>{{ t(option.label) }}</b>
                    </span>
                    <MdIcon v-if="theme.pureBlackMode === option.value" name="check" class="settings-row-check" />
                  </button>
                </div>
              </section>
              <section class="settings-detail-group" aria-labelledby="settings-colors-heading">
                <h2 id="settings-colors-heading">
                  <MdIcon name="palette" />
                  {{ t('主题色彩') }}
                  <span class="settings-color-name">{{ t(themeLabel) }}</span>
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
                      <b>{{ t('夏日的序章') }}</b>
                      <p>
                        {{ t('风穿过敞开的窗，') }}
                        <br />
                        {{ t('书页轻轻翻动。') }}
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
                  <span class="settings-badge">{{ t('阅读示意') }}</span>
                  <h2>{{ t('找到舒服的阅读节奏') }}</h2>
                  <p>{{ t('首次打开作品时，从这里开始。') }}</p>
                </div>
              </div>
              <section class="settings-detail-group" aria-labelledby="settings-layout-heading">
                <h2 id="settings-layout-heading">{{ t('翻页与布局') }}
                  <MdInfoHint v-if="isScrollDefault" :label="t('翻页与布局')">{{ t('条漫模式沿用上次的分页方向与跨页布局，切回分页后生效。') }}</MdInfoHint>
                </h2>
                <div class="settings-list">
                  <SettingsSelectRow
                    :label="t('翻页方式')"
                    :model-value="settings.transitionStyle"
                    :options="transitionOptions"
                    @update:model-value="settings.setTransitionStyle"
                  />
                  <SettingsSelectRow
                    :label="t('阅读方向')"
                    :model-value="readerDefaults.pagedDirection"
                    :options="directionOptions"
                    :disabled="isScrollDefault"
                    @update:model-value="setDirection"
                  />
                  <SettingsSelectRow
                    :label="t('跨页布局')"
                    :model-value="readerDefaults.spread"
                    :options="spreadOptions"
                    :disabled="isScrollDefault"
                    @update:model-value="setSpread"
                  />
                  <MdSwitch
                    v-if="readerDefaults.spread === 2 && !isScrollDefault"
                    class="settings-list-row"
                    :model-value="readerDefaults.coverOffset"
                    :title="t('让后续跨页大图保持对齐')"
                    @update:model-value="value => settings.setReaderDefault('coverOffset', value)"
                  >
                    <span class="settings-value-copy">
                      <b>{{ t('首页单排') }}</b>
                    </span>
                  </MdSwitch>
                  <MdSwitch
                    class="settings-list-row"
                    :model-value="readerDefaults.verticalText"
                    :title="t('文字从上往下，各列从右往左排列，仅作用于小说分页阅读')"
                    @update:model-value="value => settings.setReaderDefault('verticalText', value)"
                  >
                    <span class="settings-value-copy">
                      <b>{{ t('竖排文字') }}</b>
                    </span>
                  </MdSwitch>
                </div>
              </section>
              <section class="settings-detail-group" aria-labelledby="settings-text-heading">
                <h2 id="settings-text-heading">{{ t('文字与滚动') }}
                  <MdInfoHint :label="t('文字与滚动')">{{ t('每本书已有的阅读位置与排版记忆会继续保留。') }}</MdInfoHint>
                </h2>
                <div class="settings-list">
                  <div class="settings-detail-font">
                    <div class="settings-head">
                      <span>{{ t('默认字号') }}</span>
                      <b>{{ readerDefaults.fontSize }} px</b>
                    </div>
                    <div class="font-size-control">
                      <MdIconButton
                        type="button"
                        class="settings-icon-button"
                        :title="t('减小字号')"
                        :aria-label="t('减小字号')"
                        :disabled="readerDefaults.fontSize <= 14"
                        @click="changeDefaultFont(-2)"
                      >
                        <MdIcon name="remove" />
                      </MdIconButton>
                      <MdRange
                        class="settings-range"
                        :model-value="readerDefaults.fontSize"
                        :min="14"
                        :max="28"
                        :step="2"
                        :aria-label="t('默认字号')"
                        @update:model-value="setFontSize"
                      />
                      <MdIconButton
                        type="button"
                        class="settings-icon-button"
                        :title="t('增大字号')"
                        :aria-label="t('增大字号')"
                        :disabled="readerDefaults.fontSize >= 28"
                        @click="changeDefaultFont(2)"
                      >
                        <MdIcon name="add" />
                      </MdIconButton>
                    </div>
                  </div>
                  <SettingsSelectRow
                    :label="t('滚动宽度')"
                    :model-value="readerDefaults.webtoonFit"
                    :options="webtoonOptions"
                    @update:model-value="value => settings.setReaderDefault('webtoonFit', value)"
                  />
                  <MdSwitch
                    v-if="isAndroid"
                    class="settings-list-row"
                    :model-value="settings.volumeKeysTurnPage"
                    :title="t('音量加键上一页、音量减键下一页')"
                    @update:model-value="settings.setVolumeKeysTurnPage"
                  >
                    <span class="settings-value-copy">
                      <b>{{ t('用音量键翻页') }}</b>
                    </span>
                  </MdSwitch>
                </div>
              </section>
              <button type="button" class="settings-text-button" @click="settings.resetReaderDefaults">{{ t('恢复阅读默认值') }}</button>
            </template>
            <template v-else-if="activeSection === 'storage'">
              <div class="settings-detail-hero settings-storage-hero">
                <div class="settings-storage-hero-head">
                  <span>{{ t('本机存储用量') }}</span>
                  <MdIconButton
                    type="button"
                    class="settings-icon-button"
                    :title="t('刷新存储用量')"
                    :aria-label="t('刷新存储用量')"
                    :disabled="storageLoading"
                    @click="refreshStorage"
                  >
                    <MdIcon name="update" />
                  </MdIconButton>
                </div>
                <template v-if="diskSegments">
                  <strong class="storage-number">{{ formatBytes(diskSegments.appBytes) }}</strong>
                  <p class="settings-note">{{ t('HOMURA 占用 · 共 {0}', { 0: storageTotalText }) }}</p>
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
                      <span>{{ t('其他应用') }}</span>
                      <b>{{ formatBytes(diskSegments.otherBytes) }}</b>
                    </div>
                    <div>
                      <i class="storage-dot storage-seg-free"></i>
                      <span>{{ t('可用空间') }}</span>
                      <b>{{ formatBytes(diskSegments.freeBytes) }}</b>
                    </div>
                  </div>
                </template>
                <template v-else>
                  <strong class="storage-number">{{ storageUsageText }}</strong>
                  <p class="settings-note">{{ nativeStorageEnabled ? t('WebView 本地数据') : t('浏览器本地数据') }}</p>
                  <div
                    class="storage-bar"
                    :class="{ 'is-revealing': storageRevealing }"
                    role="progressbar"
                    :aria-label="t('本地存储用量')"
                    aria-valuemin="0"
                    aria-valuemax="100"
                    :aria-valuenow="storagePercent"
                  >
                    <i :style="{ width: storageBarWidth }"></i>
                  </div>
                  <p class="settings-note">{{ storageQuotaText }}</p>
                  <p v-if="nativeStorageEnabled" class="settings-note">{{ t('应用内存档保存在此设备，容量受可用空间限制。') }}</p>
                </template>
              </div>
              <section class="settings-detail-group" aria-labelledby="settings-smart-storage-heading">
                <h2 id="settings-smart-storage-heading"><MdIcon name="tune" />{{ t('智能存储') }}
                  <MdInfoHint :label="t('智能存储')">{{ t('仅在开启后使用。达到预算时，优先回收收益较低的自动存档。') }}</MdInfoHint>
                </h2>
                <div class="settings-list">
                  <MdSwitch
                    class="settings-list-row"
                    :model-value="settings.smartStorageEnabled"
                    :title="t('按阅读频率自动转存')"
                    @update:model-value="settings.setSmartStorageEnabled"
                  >
                    <span class="settings-value-copy">
                      <b>{{ t('自动转存常读作品') }}</b>
                    </span>
                  </MdSwitch>
                  <div class="settings-detail-font">
                    <div class="settings-head">
                      <span>{{ t('自动转存预算') }}</span>
                      <b>{{ settings.smartStorageBudgetMb }} MB</b>
                    </div>
                    <MdRange
                      class="settings-range"
                      :model-value="settings.smartStorageBudgetMb"
                      :min="SMART_STORAGE_MIN_BUDGET_MB"
                      :max="SMART_STORAGE_MAX_BUDGET_MB"
                      :step="SMART_STORAGE_BUDGET_STEP_MB"
                      :aria-label="t('自动转存预算')"
                      :aria-value-text="`${settings.smartStorageBudgetMb} MB`"
                      @update:model-value="settings.setSmartStorageBudget"
                    />
                  </div>
                </div>
              </section>
              <section v-if="diskSegments" class="settings-detail-group" aria-labelledby="settings-usage-heading">
                <h2 id="settings-usage-heading">{{ t('本机用量') }}</h2>
                <div class="settings-list">
                  <div class="settings-list-row">
                    <span class="settings-row-icon">
                      <MdIcon name="folder_open" />
                    </span>
                    <span class="settings-value-copy">
                      <b>{{ t('原始文件与缓存') }}</b>
                    </span>
                    <b class="settings-row-value">{{ storageNativeText }}</b>
                  </div>
                  <div class="settings-list-row">
                    <span class="settings-row-icon">
                      <MdIcon name="database" />
                    </span>
                    <span class="settings-value-copy">
                      <b>{{ t('WebView 本地数据') }}</b>
                    </span>
                    <b class="settings-row-value">{{ storageWebviewText }}</b>
                  </div>
                </div>
              </section>
              <section class="settings-detail-group" aria-labelledby="settings-data-heading">
                <h2 id="settings-data-heading">{{ t('数据管理') }}
                  <MdInfoHint :label="t('数据管理')">{{ t('清空书架会删除应用内存档和阅读记录。外部原文件仍由你管理。') }}</MdInfoHint>
                </h2>
                <div class="settings-list">
                  <div class="settings-list-row">
                    <span class="settings-value-copy">
                      <b>{{ t('阅读进度') }}</b>
                      <span>{{ t('{0} 本作品保留阅读位置与排版', { 0: progressCount }) }}</span>
                    </span>
                    <button
                      type="button"
                      class="settings-text-button"
                      :disabled="progressCount === 0 || actionBusy"
                      @click="requestDataAction('progress')"
                    >
                      {{ t('清空进度') }}
                    </button>
                  </div>
                  <div class="settings-list-row">
                    <span class="settings-value-copy">
                      <b>{{ t('书架与应用内存档') }}</b>
                      <span>{{ t('{0} 部作品，删除后无法恢复', { 0: shelf.library.length }) }}</span>
                    </span>
                    <button
                      type="button"
                      class="settings-text-button"
                      :disabled="shelf.library.length === 0 || actionBusy"
                      @click="requestDataAction('shelf')"
                    >
                      {{ t('清空书架') }}
                    </button>
                  </div>
                </div>
                <p v-if="actionNote" class="settings-detail-note" role="status">{{ actionNote }}</p>
              </section>
            </template>
            <SyncSettings v-else-if="activeSection === 'sync'" />
            <template v-else-if="activeSection === 'logs'">
              <div class="settings-detail-hero settings-logs-hero">
                <div class="settings-detail-hero-heading">
                  <span class="settings-detail-hero-icon" aria-hidden="true"><MdIcon name="history" /></span>
                  <h2>{{ settings.runtimeLogCapture ? t('记录中') : t('已暂停') }}</h2>
                </div>
                <dl class="settings-logs-summary">
                  <div>
                    <dt>{{ t('信息') }}</dt>
                    <dd>{{ runtimeLogs.infoCount }}</dd>
                  </div>
                  <div>
                    <dt>{{ t('警告') }}</dt>
                    <dd>{{ runtimeLogs.warningCount }}</dd>
                  </div>
                  <div>
                    <dt>{{ t('错误') }}</dt>
                    <dd>{{ runtimeLogs.errorCount }}</dd>
                  </div>
                </dl>
              </div>
              <section class="settings-detail-group" aria-labelledby="settings-log-settings-heading">
                <h2 id="settings-log-settings-heading">{{ t('记录偏好') }}
                  <MdInfoHint :label="t('记录偏好')">{{ t('启用捕获后，用户操作记录不受日志等级影响；等级控制控制台诊断信息。日志只保存在本机，不会随同步上传。') }}</MdInfoHint>
                </h2>
                <div class="settings-list">
                  <MdSwitch
                    class="settings-list-row"
                    :model-value="settings.runtimeLogCapture"
                    @update:model-value="settings.setRuntimeLogCapture"
                  >
                    <span class="settings-value-copy"><b>{{ t('日志捕获') }}</b></span>
                  </MdSwitch>
                  <SettingsSelectRow
                    :label="t('日志等级')"
                    :model-value="settings.runtimeLogLevel"
                    :options="logLevelOptions"
                    @update:model-value="settings.setRuntimeLogLevel"
                  />
                </div>
              </section>
              <section class="settings-detail-group" aria-labelledby="settings-recent-log-heading">
                <div class="settings-log-section-heading">
                  <h2 id="settings-recent-log-heading">{{ t('最近记录') }}</h2>
                  <span class="settings-log-count">{{ t('{0} 条记录', { 0: filteredLogs.length }) }}</span>
                  <button
                    type="button"
                    class="settings-text-button settings-log-clear"
                    :class="{ 'is-armed': logsClearArmed }"
                    :disabled="runtimeLogs.entries.length === 0"
                    @click="requestLogClear"
                  >
                    {{ logsClearArmed ? t('确认清空日志') : t('清空全部日志') }}
                  </button>
                </div>
                <div role="status">
                  <p v-if="logActionNote" class="settings-log-action-note">{{ logActionNote }}</p>
                </div>
                <div class="settings-list settings-log-panel">
                  <div class="settings-log-filter">
                    <MdSegmentedControl
                      :model-value="logFilter"
                      :options="logFilterOptions"
                      :aria-label="t('筛选日志等级')"
                      @update:model-value="setLogFilter"
                    />
                  </div>
                  <ul v-if="filteredLogs.length" class="settings-log-list" role="list">
                    <li v-for="entry in filteredLogs" :key="entry.id" class="settings-log-entry" :class="`is-${entry.level}`">
                      <span class="settings-row-icon settings-log-marker" aria-hidden="true">
                        <MdIcon :name="entry.level === 'error' ? 'error' : entry.level === 'warning' ? 'warning' : entry.source === 'operation' ? 'history' : 'info'" />
                      </span>
                      <div class="settings-log-entry-body">
                        <p class="settings-log-message">{{ entry.message }}</p>
                        <div class="settings-log-meta">
                          <span>{{ t(entry.level === 'info' ? '信息' : entry.level === 'warning' ? '警告' : '错误') }}</span>
                          <span>{{ entry.source === 'operation' ? t('用户操作') : formatRuntimeLogSource(entry.source) }}</span>
                          <time class="settings-log-time">{{ formatRuntimeLogTimestamp(entry.at) }}</time>
                        </div>
                        <details v-if="entry.detail" class="settings-log-detail">
                          <summary><MdIcon name="expand_more" :size="16" />{{ t('查看详情') }}</summary>
                          <pre>{{ entry.detail }}</pre>
                        </details>
                      </div>
                    </li>
                  </ul>
                  <div v-else class="settings-log-empty">
                    <span class="settings-row-icon" aria-hidden="true"><MdIcon :name="logSearchActive ? 'search' : 'history'" /></span>
                    <div>
                      <b>{{ logSearchActive || logFilter !== 'all' ? t('没有匹配的日志') : !settings.runtimeLogCapture ? t('日志捕获已关闭。') : t('暂无日志') }}</b>
                      <p v-if="logSearchActive">{{ t('换个关键词，或切换等级再试试。') }}</p>
                    </div>
                  </div>
                </div>
              </section>
            </template>
            <template v-else-if="activeSection === 'about'">
              <div class="settings-detail-hero settings-about-hero">
                <img :src="logoUrl" :alt="t('HOMURA 应用图标')" />
                <h2>HOMURA</h2>
                <span class="settings-badge">{{ appVersion }}</span>
                <p>{{ t('把故事留在本机，把阅读留给自己。') }}</p>
                <p class="settings-note">
                  {{ t('漫画、轻小说与图集都在设备内解析。') }}
                  <br />
                  {{ t('原始文件不会上传，进度、收藏与书库可选同步。') }}
                </p>
              </div>
              <section class="settings-detail-group" aria-labelledby="settings-update-heading">
                <h2 id="settings-update-heading">{{ t('版本与更新') }}</h2>
                <div class="settings-list">
                  <button type="button" class="settings-list-row" @click="updates.handlePrimaryUpdateAction">
                    <span class="settings-row-icon">
                      <MdIcon name="update" />
                    </span>
                    <span class="settings-value-copy">
                      <b>{{ hasPendingInstall ? t('继续安装') : t('检查更新') }}</b>
                    </span>
                    <span class="settings-row-value">{{ hasPendingInstall ? t('安装包已就绪') : t('手动检查') }}</span>
                    <MdIcon name="chevron_right" />
                  </button>
                  <button type="button" class="settings-list-row" @click="updates.openChangelog">
                    <span class="settings-row-icon">
                      <MdIcon name="article" />
                    </span>
                    <span class="settings-value-copy">
                      <b>{{ t('更新日志') }}</b>
                    </span>
                    <i v-if="hasNewRelease" class="about-log-new" :aria-label="t('有新版本')"></i>
                    <MdIcon name="chevron_right" />
                  </button>
                </div>
              </section>
              <section class="settings-detail-group" aria-labelledby="settings-open-source-heading">
                <h2 id="settings-open-source-heading">{{ t('开源信息') }}</h2>
                <div class="settings-list">
                  <button type="button" class="settings-list-row" @click="openRepository">
                    <span class="settings-row-icon">
                      <MdIcon name="open_in_new" />
                    </span>
                    <span class="settings-value-copy">
                      <b>{{ t('开源仓库') }}</b>
                    </span>
                    <span class="settings-row-value">GitHub</span>
                    <MdIcon name="chevron_right" />
                  </button>
                  <button type="button" class="settings-list-row" @click="openLicense">
                    <span class="settings-row-icon">
                      <MdIcon name="info" />
                    </span>
                    <span class="settings-value-copy">
                      <b>{{ t('开源许可') }}</b>
                    </span>
                    <span class="settings-row-value">MIT License</span>
                    <MdIcon name="chevron_right" />
                  </button>
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
                <h2>{{ t('让作品，井井有条') }}</h2>
                <p>{{ t('从文件夹到书库，保留你熟悉的整理方式。') }}</p>
              </div>
              <section class="settings-detail-group" aria-labelledby="settings-import-behavior-heading">
                <h2 id="settings-import-behavior-heading">{{ t('导入行为') }}
                  <MdInfoHint :label="t('导入行为')">
                    <p>{{ t('关闭后直接导入作品；开启后，目录导入会先询问是否按目录创建一级书库。') }}</p>
                    <p>{{ t('偏好会自动保存，仅影响之后的导入。') }}</p>
                  </MdInfoHint>
                </h2>
                <div class="settings-list">
                  <MdSwitch
                    class="settings-list-row"
                    :model-value="settings.importCollectionPrompt"
                    :title="t('导入多本作品时询问是否创建书库')"
                    @update:model-value="settings.setImportCollectionPrompt"
                  >
                    <span class="settings-value-copy">
                      <b>{{ t('导入时询问创建书库') }}</b>
                    </span>
                  </MdSwitch>
                </div>
              </section>
            </template>
            <template v-else-if="activeSection === 'debug'">
              <div class="settings-detail-hero settings-detail-hero-heading">
                <span class="settings-detail-hero-icon" aria-hidden="true"><MdIcon name="science" /></span>
                <h2>{{ t('调试与实验功能') }}</h2>
              </div>
              <section class="settings-detail-group" aria-labelledby="settings-debug-general-heading">
                <h2 id="settings-debug-general-heading">{{ t('更新与界面') }}</h2>
                <div class="settings-list">
                  <MdSwitch
                    class="settings-list-row"
                    :model-value="settings.debugAutoUpdateCheck"
                    @update:model-value="settings.setDebugAutoUpdateCheck"
                  >
                    <span class="settings-debug-switch-label">
                      <span class="settings-row-icon"><MdIcon name="update" /></span>
                      <span class="settings-value-copy"><b>{{ t('启动时静默检查更新') }}</b></span>
                    </span>
                  </MdSwitch>
                  <MdSwitch
                    class="settings-list-row"
                    :model-value="settings.showFullscreenButton"
                    @update:model-value="settings.setShowFullscreenButton"
                  >
                    <span class="settings-debug-switch-label">
                      <span class="settings-row-icon"><MdIcon name="fullscreen" /></span>
                      <span class="settings-value-copy"><b>{{ t('显示全屏按钮') }}</b></span>
                    </span>
                  </MdSwitch>
                </div>
              </section>
              <section class="settings-detail-group" aria-labelledby="settings-demo-heading">
                <h2 id="settings-demo-heading">{{ t('示例内容') }}</h2>
                <div class="settings-list">
                  <button type="button" class="settings-list-row" @click="addDemoManga">
                    <span class="settings-row-icon"><MdIcon name="auto_stories" /></span>
                    <span class="settings-value-copy"><b>{{ t('添加示例漫画') }}</b></span>
                    <MdIcon name="add" />
                  </button>
                  <button type="button" class="settings-list-row" @click="addDemoNovel">
                    <span class="settings-row-icon"><MdIcon name="article" /></span>
                    <span class="settings-value-copy"><b>{{ t('添加示例小说') }}</b></span>
                    <MdIcon name="add" />
                  </button>
                </div>
                <div role="status">
                  <p v-if="debugNote" class="settings-detail-note">{{ debugNote }}</p>
                </div>
              </section>
            </template>
          </div>
          <footer class="settings-footer">
            <span>{{ t('作品保存在本机，同步由你选择。') }}</span>
            <span>HOMURA · ACGN GO</span>
          </footer>
        </div>
      </div>
    </section>
  </Teleport>
  <MobileBottomSheet v-if="isCompact" :open="!!pendingAction" :title="t(dataDialogTitle)" title-id="mobile-settings-dialog-title"
    description-id="mobile-settings-dialog-copy" :busy="actionBusy" @close="closeDataDialog" @cancel="closeDataDialog"
    @opened="mobileCancelButtonRef?.focus()">
    <p class="md-mobile-sheet-label">{{ t('请确认影响范围') }}</p>
    <div class="md-mobile-sheet-card">
      <div class="md-mobile-sheet-row">
        <span class="md-mobile-sheet-icon is-danger"><MdIcon name="delete" /></span>
        <span class="md-mobile-sheet-copy"><b>{{ displayedAction === 'shelf' ? t('书架、应用内存档与阅读记录') : t('阅读位置与排版记忆') }}</b>
          <small id="mobile-settings-dialog-copy">{{ t(dataDialogDescription) }}</small>
        </span>
      </div>
    </div>
    <div class="md-mobile-sheet-card md-mobile-sheet-notice is-danger">
      <MdIcon name="warning" /><span class="md-mobile-sheet-copy"><b>{{ t('此操作无法撤销') }}</b><small>{{ t('请确认后再继续。') }}</small></span>
    </div>
    <template #footer>
      <button type="button" class="md-filled-button md-mobile-sheet-danger" :disabled="actionBusy" @click="confirmDataAction">{{ actionBusy ? t('正在清空') : t('确认清空') }}</button>
      <button ref="mobileCancelButtonRef" type="button" class="md-tonal-button" :disabled="actionBusy" @click="closeDataDialog">{{ t('取消') }}</button>
    </template>
  </MobileBottomSheet>
  <Teleport v-if="!isCompact" to="body">
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
          <h3 id="settings-dialog-title">{{ t(dataDialogTitle) }}</h3>
          <p id="settings-dialog-copy">{{ t(dataDialogDescription) }}</p>
          <div class="settings-dialog-actions">
            <button
              ref="cancelButtonRef"
              type="button"
              class="settings-dialog-button is-secondary"
              :disabled="actionBusy"
              @click="closeDataDialog"
            >
              {{ t('取消') }}
            </button>
            <button
              ref="confirmButtonRef"
              type="button"
              class="settings-dialog-button is-primary"
              :disabled="actionBusy"
              @click="confirmDataAction"
            >
              {{ actionBusy ? t('正在清空') : t('确认清空') }}
            </button>
          </div>
        </section>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, provide, ref, shallowRef, watch } from 'vue';
import { storeToRefs } from 'pinia';
import packageInfo from '../../package.json';
import { createDemoManga, createDemoNovel } from '../services/demo.ts';
import { HomuraStore } from '../services/storage.ts';
import { canUseNativeStorage } from '../services/nativeStorage.ts';
import { buildStorageSegments, readDiskStorageStats } from '../services/storageStats.ts';
import type { DiskStorageStats } from '../services/storageStats.ts';
import { formatBytes, isAndroid } from '../services/platform.ts';
import { openGitHubUrl } from '../services/external.ts';
import { LICENSE_PAGE_URL, REPOSITORY_URL } from '../services/updates.ts';
import {
  formatRuntimeLogSource,
  formatRuntimeLogTimestamp,
  matchesRuntimeLogQuery,
  type RuntimeLogFilter,
  type RuntimeLogLevel
} from '../services/runtimeLogs.ts';
import { deliverRuntimeLogExport, formatRuntimeLogEntries, runtimeLogExportFileName } from '../services/runtimeLogExport.ts';
import {
  SMART_STORAGE_BUDGET_STEP_MB,
  SMART_STORAGE_MAX_BUDGET_MB,
  SMART_STORAGE_MIN_BUDGET_MB
} from '../services/smartStorageSettings.ts';
import { useShelfStore } from '../stores/shelf.ts';
import { useReaderStore } from '../stores/reader.ts';
import { useSettingsStore } from '../stores/settings.ts';
import { useRuntimeLogStore } from '../stores/runtimeLogs.ts';
import {
  SURFACE_MODE_OPTIONS,
  THEME_OPTIONS,
  TRANSITION_OPTIONS,
  useThemeStore
} from '../stores/theme.ts';
import { WEBTOON_FIT_LABELS } from '../stores/reader.ts';
import { useUpdateStore } from '../stores/updates.ts';
import { useSyncStore } from '../stores/sync.ts';
import { useViewport } from '../composables/useViewport.ts';
import { createSettingsTransition, measureSettingsTransition, settingsSelectBackKey } from '../composables/useSettingsTransition.ts';
import { readSettingsSection, sectionTitles, type SettingsSection } from '../services/settingsSectionHistory.ts';
import type { NativeBackEvent } from '../composables/useAndroidBackExit.ts';
import MdIcon from './MdIcon.vue';
import MdIconButton from './MdIconButton.vue';
import MdInfoHint from './MdInfoHint.vue';
import MobileBottomSheet from './MobileBottomSheet.vue';
import MdRange from './MdRange.vue';
import MdSegmentedControl from './MdSegmentedControl.vue';
import MdSwitch from './MdSwitch.vue';
import ThemeSwatchGrid from './ThemeSwatchGrid.vue';
import SettingsInterfacePreview from './SettingsInterfacePreview.vue';
import SettingsSelectRow from './SettingsSelectRow.vue';
import SyncSettings from './SyncSettings.vue';
import { useI18n } from '../composables/useI18n.ts';

const { t, locale, localeOptions, setLocale } = useI18n();

const logoUrl = import.meta.env.BASE_URL + 'favicon.png';
const shelf = useShelfStore();
const settings = useSettingsStore();
const theme = useThemeStore();
const updates = useUpdateStore();
const sync = useSyncStore();
const runtimeLogs = useRuntimeLogStore();
const { hasNewRelease, hasPendingInstall } = storeToRefs(updates);
const appVersion = packageInfo.version;
const { isCompact } = useViewport();
const reader = useReaderStore();
const readerDefaults = settings.readerDefaults;
const aboutLinkError = ref('');
const debugNote = ref('');

const transitionOptions = TRANSITION_OPTIONS;
const directionOptions = [
  { value: 'ltr', label: '从左到右', title: '普通排版', icon: 'chevron_right' },
  { value: 'rtl', label: '从右到左', title: '日漫', icon: 'chevron_left' }
];
const spreadOptions = [
  { value: 1, label: '单页', icon: 'article' },
  { value: 2, label: '双页', icon: 'auto_stories' }
];
const webtoonOptions = [
  { value: 'screen', label: WEBTOON_FIT_LABELS.screen },
  { value: 'medium', label: WEBTOON_FIT_LABELS.medium },
  { value: 'wide', label: WEBTOON_FIT_LABELS.wide }
];
const logLevelOptions: { value: RuntimeLogLevel; label: string }[] = [
  { value: 'error', label: '错误' },
  { value: 'warning', label: '警告' },
  { value: 'info', label: '信息' }
];
const logFilterOptions = [
  { value: 'all', label: '全部' },
  { value: 'info', label: '信息' },
  { value: 'warning', label: '警告' },
  { value: 'error', label: '错误' }
];

const emit = defineEmits(['detail-change']);
const activeSection = ref<SettingsSection | null>(null);
const preparingDetail = ref(false);
const detailSettled = ref(false);
const returningDetail = ref(false);
const detailInsets = shallowRef<{ left: string; right: string }>();
const logFilter = ref<RuntimeLogFilter>('all');
const logsClearArmed = ref(false);
let logsClearTimer: ReturnType<typeof setTimeout> | null = null;
const logSearchOpen = ref(false);
const logQuery = ref('');
const logSearchInputRef = shallowRef<HTMLInputElement | null>(null);
const logExporting = ref(false);
const logActionNote = ref('');
let logActionNoteTimer: ReturnType<typeof setTimeout> | null = null;
const pageRef = shallowRef<HTMLElement | null>(null);
const backButtonRef = shallowRef<InstanceType<typeof MdIconButton> | null>(null);
const clipRef = shallowRef<HTMLElement | null>(null);
const surfaceRef = shallowRef<HTMLElement | null>(null);
const detailRef = shallowRef<HTMLElement | null>(null);
const selectBack = shallowRef<(() => void) | null>(null);
provide(settingsSelectBackKey, selectBack);
let anchor: ReturnType<typeof measureSettingsTransition>['anchor'] = null;
let motion: ReturnType<typeof createSettingsTransition> = null;
let measureFrame = 0;
let backRequestTimer: number | undefined;
let afterReturn: (() => void) | undefined;
let motionPreference: MediaQueryList | undefined;
let resizeObserver: ResizeObserver | undefined;
let previousScrollRestoration: ScrollRestoration;
const PREDICTIVE_SETTLE_MS = 250;
let backGestureActive = false;
let gestureStartProgress = 0;
const detailSurfaceOptions = ['auto', 'light', 'dark'].map(value => {
  const option = SURFACE_MODE_OPTIONS.find(item => item.value === value)!;
  return {
    ...option,
    label: value === 'auto' ? '跟随系统' : option.label
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
  return option ? t(option.title.replace(' (默认)', '')) : theme.themeColor;
});
const isScrollDefault = computed(() => readerDefaults.direction === 'vertical');
const storageInfo = ref<{ usage: number; quota: number; ratio: number } | null>(null);
const diskStats = ref<DiskStorageStats | null>(null);
const storageRevealing = ref(false);
const nativeStorageEnabled = canUseNativeStorage();
const storageLoading = ref(true);
const actionNote = ref('');
const pendingAction = ref<string | null>(null);
const displayedAction = ref<string | null>(null);
const mobileCancelButtonRef = shallowRef<HTMLButtonElement | null>(null);
const actionBusy = ref(false);
const cancelButtonRef = ref<HTMLButtonElement | null>(null);
const confirmButtonRef = ref<HTMLButtonElement | null>(null);
let dialogTrigger: HTMLElement | null = null;
const modalLayerOpen = computed(() => !!pendingAction.value);
let previousModalBodyOverflow = '';
let modalLayerLocked = false;

const storageUsageText = computed(() => {
  if (storageLoading.value) return t('正在读取');
  if (!storageInfo.value) return t('无法估算');
  return formatBytes(storageInfo.value.usage || 0);
});
const storageQuotaText = computed(() => {
  if (storageLoading.value) return '';
  if (!storageInfo.value || !storageInfo.value.quota) return t('当前环境未提供容量信息');
  const free = Math.max(0, storageInfo.value.quota - storageInfo.value.usage);
  return t('可用 {0}', { 0: formatBytes(free) });
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
const filteredLogs = computed(() => {
  const keyword = logQuery.value.trim();
  return runtimeLogs.newestFirst.filter(entry =>
    (logFilter.value === 'all' || entry.level === logFilter.value) && matchesRuntimeLogQuery(entry, keyword)
  );
});
const logSearchActive = computed(() => logQuery.value.trim().length > 0);
const logTotalText = computed(() => t('{0} 条记录', { 0: runtimeLogs.entries.length }));
const syncStatusBadge = computed(() => {
  if (!sync.config.url) return t('暂无信息');
  return sync.enabled ? t('同步已启用') : t('已暂停');
});
const syncCardNote = computed(() => {
  if (sync.config.url && sync.pendingCount > 0) return t('待同步 {0} 项', { 0: sync.pendingCount });
  return t('同步阅读进度、收藏与书库，原始文件不会上传。');
});
const storageNativeText = computed(() =>
  diskStats.value ? formatBytes(diskStats.value.appBytes) : '0 B'
);
const storageWebviewText = computed(() => formatBytes(storageInfo.value?.usage || 0));
const storageAriaLabel = computed(() => {
  const segments = diskSegments.value;
  if (!segments) return t('磁盘存储用量');
  return t('HOMURA 使用 {0}，其他应用使用 {1}，磁盘剩余 {2}', { 0: formatBytes(segments.appBytes), 1: formatBytes(segments.otherBytes), 2: formatBytes(segments.freeBytes) });
});
const progressCount = computed(() => Object.keys(shelf.progressMap || {}).length);
const dataDialogTitle = computed(() =>
  displayedAction.value === 'shelf' ? t('清空书架与应用内存档？') : t('清空阅读进度？')
);
const dataDialogDescription = computed(() => {
  if (displayedAction.value === 'shelf') {
    return t('将删除 {0} 部作品、应用内存档与阅读记录。此操作无法撤销。', { 0: shelf.library.length });
  }
  return t('将删除 {0} 本作品的阅读位置与排版记忆。作品本身不会被删除。', { 0: progressCount.value });
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

function setLogFilter(value: string | number) {
  const next = value as RuntimeLogFilter;
  if (next === 'all' || next === 'info' || next === 'warning' || next === 'error') {
    logFilter.value = next;
  }
}

function disarmLogClear() {
  logsClearArmed.value = false;
  if (logsClearTimer) {
    clearTimeout(logsClearTimer);
    logsClearTimer = null;
  }
}

function requestLogClear() {
  if (!logsClearArmed.value) {
    logsClearArmed.value = true;
    logsClearTimer = setTimeout(disarmLogClear, 4000);
    return;
  }
  runtimeLogs.clear();
  disarmLogClear();
}

function openLogSearch() {
  logSearchOpen.value = true;
  nextTick(() => logSearchInputRef.value?.focus());
}

function closeLogSearch() {
  logSearchOpen.value = false;
  logQuery.value = '';
}

function setLogActionNote(text: string) {
  logActionNote.value = text;
  if (logActionNoteTimer) clearTimeout(logActionNoteTimer);
  logActionNoteTimer = setTimeout(() => {
    logActionNote.value = '';
    logActionNoteTimer = null;
  }, 6000);
}

function clearLogActionNote() {
  logActionNote.value = '';
  if (logActionNoteTimer) {
    clearTimeout(logActionNoteTimer);
    logActionNoteTimer = null;
  }
}

async function exportLogs() {
  if (logExporting.value || !filteredLogs.value.length) return;
  logExporting.value = true;
  clearLogActionNote();
  try {
    const now = new Date();
    const filterLabel = logFilterOptions.find(option => option.value === logFilter.value)?.label || '全部';
    const keyword = logQuery.value.trim();
    const header = [
      t('HOMURA 运行日志'),
      `${t('导出时间')}：${formatRuntimeLogTimestamp(now.getTime())}`,
      `${t('筛选')}：${t(filterLabel)}${keyword ? ` · ${t('关键词')}：${keyword}` : ''}`,
      t('共 {0} 条', { 0: filteredLogs.value.length }),
      ''
    ].join('\n');
    const contents = `${header}\n${formatRuntimeLogEntries(filteredLogs.value)}\n`;
    const outcome = await deliverRuntimeLogExport(contents, runtimeLogExportFileName(now));
    if (outcome === 'cancelled') return;
    const notes: Record<string, string> = {
      saved: '日志已导出',
      downloaded: '日志已下载',
      copied: '日志已复制到剪贴板',
      failed: '导出失败，请重试'
    };
    setLogActionNote(t(notes[outcome] || '导出失败，请重试'));
  } finally {
    logExporting.value = false;
  }
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

async function openAboutGitHubLink(url: string, logLabel: string) {
  aboutLinkError.value = '';
  try {
    await openGitHubUrl(url);
  } catch (error) {
    aboutLinkError.value = t('无法打开系统浏览器，请稍后再试。');
    console.warn(logLabel, error);
  }
}

function openRepository() {
  return openAboutGitHubLink(REPOSITORY_URL, '打开开源仓库失败');
}

function openLicense() {
  return openAboutGitHubLink(LICENSE_PAGE_URL, '打开开源许可失败');
}


function sectionTrigger(section: SettingsSection) {
  return pageRef.value?.querySelector<HTMLButtonElement>(`.settings-${section} > .settings-card-open`);
}

function measureSection(section: SettingsSection) {
  if (!pageRef.value) return;
  const card = sectionTrigger(section)?.closest<HTMLElement>('.settings-card') ?? null;
  const geometry = measureSettingsTransition(pageRef.value, card);
  detailInsets.value = geometry.insets;
  anchor = geometry.anchor;
}

function finishSectionMotion() {
  cancelAnimationFrame(measureFrame);
  measureFrame = 0;
  motion?.destroy();
  motion = null;
  preparingDetail.value = false;
  returningDetail.value = false;
  backGestureActive = false;
  const previous = activeSection.value;
  const section = readSettingsSection(window.history.state);
  detailSettled.value = !!section;
  if (section) {
    if (previous !== section) enterSection(section, false);
    return;
  }
  if (!previous) return;
  activeSection.value = null;
  emit('detail-change', false);
  const navigate = afterReturn;
  afterReturn = undefined;
  if (navigate) navigate();
  else void nextTick(() => sectionTrigger(previous)?.focus({ preventScroll: true }));
}

function startMotion(progress: number) {
  if (motion || !clipRef.value || !surfaceRef.value || !detailRef.value || !anchor) return motion;
  motion = createSettingsTransition(clipRef.value, surfaceRef.value, detailRef.value, anchor, progress, finishSectionMotion);
  return motion;
}

function enterSection(section: SettingsSection, animate: boolean) {
  if (!animate) measureSection(section);
  preparingDetail.value = animate;
  detailSettled.value = !animate;
  activeSection.value = section;
  emit('detail-change', true);
  void nextTick(() => {
    if (activeSection.value !== section || readSettingsSection(window.history.state) !== section) return;
    const transition = animate ? startMotion(1) : null;
    preparingDetail.value = false;
    if (transition) transition.playTo(0, finishSectionMotion);
    else detailSettled.value = true;
    backButtonRef.value?.button?.focus({ preventScroll: true });
  });
  if (section === 'storage' && !storageLoading.value) refreshStorage();
}

function openSection(section: SettingsSection) {
  if (activeSection.value) return;
  // 先读取入口位置，随后的 History 和 Vue 更新都不会重置概览滚动。
  measureSection(section);
  try {
    window.history.pushState({ ...window.history.state, homuraSettings: true, subPage: section }, '');
  } catch (error) {
    console.warn('[HOMURA] 写入设置详情历史失败', error);
    return;
  }
  selectBack.value?.();
  enterSection(section, true);
}

function clearBackRequest() {
  window.clearTimeout(backRequestTimer);
  backRequestTimer = undefined;
}

function showPreviousSection() {
  if (actionBusy.value || !readSettingsSection(window.history.state) || backRequestTimer !== undefined) return;
  selectBack.value?.();
  try {
    window.history.back();
    backRequestTimer = window.setTimeout(() => {
      clearBackRequest();
      afterReturn = undefined;
      backGestureActive = false;
      if (readSettingsSection(window.history.state)) motion?.playTo(0, finishSectionMotion);
    }, 600);
  } catch (error) {
    afterReturn = undefined;
    backGestureActive = false;
    motion?.playTo(0, finishSectionMotion);
    console.warn('[HOMURA] 返回设置概览失败', error);
  }
}

function onSectionPopState(event: PopStateEvent) {
  clearBackRequest();
  const settleDuration = backGestureActive ? PREDICTIVE_SETTLE_MS : undefined;
  backGestureActive = false;
  const section = readSettingsSection(event.state);
  if (section) {
    afterReturn = undefined;
    if (section === activeSection.value) motion?.playTo(0, finishSectionMotion);
    else {
      motion?.destroy();
      motion = null;
      returningDetail.value = false;
      enterSection(section, false);
    }
    return;
  }

  const previous = activeSection.value;
  if (!previous) return;
  selectBack.value?.();
  closeDataDialog();
  if (motion) {
    returningDetail.value = true;
    motion.playTo(1, finishSectionMotion, settleDuration);
    return;
  }
  // 等到独立的读帧再确认落点。详情与底层布局在这之前都留在原位。
  cancelAnimationFrame(measureFrame);
  measureFrame = requestAnimationFrame(() => {
    measureFrame = 0;
    if (readSettingsSection(window.history.state)) return;
    measureSection(previous);
    const transition = startMotion(0);
    if (!transition) finishSectionMotion();
    else {
      returningDetail.value = true;
      transition.playTo(1, finishSectionMotion, settleDuration);
    }
  });
}

function leaveDetail(navigate: () => void) {
  if (!activeSection.value) return false;
  if (actionBusy.value) return true;
  afterReturn = navigate;
  showPreviousSection();
  return true;
}

function dismissBack() {
  if (pendingAction.value) {
    closeDataDialog();
    return true;
  }
  if (selectBack.value) {
    selectBack.value();
    return true;
  }
  if (!activeSection.value) return false;
  showPreviousSection();
  return true;
}

function canUsePredictiveBack() {
  return !!activeSection.value && !pendingAction.value && !actionBusy.value && !selectBack.value;
}

function onPredictiveBack(event: NativeBackEvent) {
  if (event.phase === 'invoked') {
    dismissBack();
    return;
  }
  if (!readSettingsSection(window.history.state) || backRequestTimer !== undefined) return;
  if (event.phase === 'started') {
    backGestureActive = true;
    gestureStartProgress = startMotion(0)?.pause() ?? 0;
  } else if (event.phase === 'progressed' && backGestureActive) {
    const progress = Math.max(0, Math.min(1, event.progress ?? 0));
    motion?.seek(gestureStartProgress + (1 - gestureStartProgress) * progress);
  } else if (event.phase === 'cancelled') {
    backGestureActive = false;
    motion?.playTo(0, finishSectionMotion);
  }
}

function onSettingsResize() {
  if (motion || measureFrame) finishSectionMotion();
  if (activeSection.value) measureSection(activeSection.value);
}

defineExpose({ dismissBack, canUsePredictiveBack, onPredictiveBack, leaveDetail });

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
  debugNote.value = t('已添加「{0}」', { 0: book.title });
}

function addDemoNovel() {
  const book = createDemoNovel();
  shelf.unshiftBook(book);
  debugNote.value = t('已添加「{0}」', { 0: book.title });
}

function requestDataAction(action: string) {
  if (actionBusy.value) return;
  dialogTrigger = document.activeElement as HTMLElement | null;
  displayedAction.value = action;
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
      actionNote.value = t('书架与应用内存档已清空');
    } else {
      await shelf.clearProgress();
      actionNote.value = t('阅读进度已清空');
    }
  } catch (err) {
    actionNote.value = (err as Error).message || t('清空失败，请重试');
    console.warn('[HOMURA] 清空数据失败', err);
  } finally {
    await refreshStorage();
    actionBusy.value = false;
    pendingAction.value = null;
  }
}

function onDialogKeydown(event: KeyboardEvent) {
  if (reader.currentBook) return;
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
  if (isCompact.value) return;
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

watch(activeSection, () => {
  disarmLogClear();
  closeLogSearch();
  clearLogActionNote();
});

onMounted(() => {
  refreshStorage();
  window.addEventListener('keydown', onDialogKeydown);
  window.addEventListener('popstate', onSectionPopState);
  window.addEventListener('resize', onSettingsResize);
  window.addEventListener('pagehide', finishSectionMotion);
  motionPreference = window.matchMedia('(prefers-reduced-motion: reduce)');
  motionPreference.addEventListener('change', finishSectionMotion);
  previousScrollRestoration = window.history.scrollRestoration;
  window.history.scrollRestoration = 'manual';
  if (pageRef.value && typeof ResizeObserver !== 'undefined') {
    resizeObserver = new ResizeObserver(() => {
      if (!motion && activeSection.value) measureSection(activeSection.value);
    });
    resizeObserver.observe(pageRef.value);
  }
  const section = readSettingsSection(window.history.state);
  if (section) enterSection(section, false);
});

onBeforeUnmount(() => {
  emit('detail-change', false);
  disarmLogClear();
  clearLogActionNote();
  window.removeEventListener('keydown', onDialogKeydown);
  window.removeEventListener('popstate', onSectionPopState);
  window.removeEventListener('resize', onSettingsResize);
  window.removeEventListener('pagehide', finishSectionMotion);
  motionPreference?.removeEventListener('change', finishSectionMotion);
  resizeObserver?.disconnect();
  clearBackRequest();
  cancelAnimationFrame(measureFrame);
  motion?.destroy();
  window.history.scrollRestoration = previousScrollRestoration;
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
  pointer-events: none;
}

.has-detail .settings-topbar {
  background: var(--md-surface-low);
}

.settings-transition-layer {
  position: fixed;
  inset: 0;
  z-index: 49;
  isolation: isolate;
}

.settings-transition-layer.is-preparing {
  visibility: hidden;
}

.settings-transition-clip,
.settings-transition-surface,
.settings-transition-clip > .settings-page {
  position: absolute;
  inset: 0;
}

.settings-transition-surface {
  background: var(--md-surface-low);
  pointer-events: none;
}

.settings-transition-clip.is-morphing > .settings-transition-surface {
  clip-path: var(--settings-anchor-clip);
}

.settings-transition-surround {
  display: none;
}

.settings-transition-clip.is-morphing > .settings-transition-surround {
  display: block;
  position: absolute;
  inset: var(--settings-anchor-inset);
  border-radius: var(--settings-anchor-radius);
  outline: 150vmax solid var(--md-surface-low);
  pointer-events: none;
}

.settings-transition-clip > .settings-page {
  overflow: auto;
  overscroll-behavior: contain;
  background: transparent;
  opacity: 0;
}

.settings-transition-layer.is-settled .settings-transition-clip > .settings-page {
  opacity: 1;
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

.settings-import-status {
  position: sticky;
  top: calc(88px + env(safe-area-inset-top));
  z-index: 19;
}

.settings-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 18px;
  max-width: 1480px;
  margin: auto;
  padding: 12px 28px 0;
}

.settings-card {
  --settings-card-padding: 24px;
  --settings-card-radius: 32px;
  position: relative;
  isolation: isolate;
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-width: 0;
  padding: var(--settings-card-padding);
  border-radius: var(--settings-card-radius);
  background: var(--md-surface);
  box-shadow: 0 6px 10px -8px color-mix(in oklab, var(--md-shadow-color-soft) 18%, transparent), 0 14px 30px -16px color-mix(in oklab, var(--md-shadow-color-soft) 24%, transparent);
}

.settings-card-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  min-height: 44px;
  flex-wrap: wrap;
  row-gap: 4px;
}

.settings-card-head h2 {
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0;
  font-size: 17px;
  font-weight: 650;
}

.settings-card-head h2 svg {
  flex: none;
  width: 20px;
  height: 20px;
  color: var(--md-on-surface-variant);
}

.settings-card-head > span,
.settings-grid .settings-note,
.settings-grid .settings-value-copy span,
.settings-log-summary,
.settings-control-label {
  color: var(--md-on-surface-variant);
  font-size: 12px;
  line-height: 1.5;
}

.settings-note {
  margin: 8px 0 0;
  font-size: 11px;
  line-height: 1.7;
  color: var(--md-on-surface-variant);
}

.settings-appearance {
  grid-column: 1 / -1;
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(190px, 31%);
  align-items: center;
  column-gap: 24px;
}

.settings-appearance > .settings-card-open {
  grid-column: 1 / -1;
}

.settings-appearance .settings-book-stage {
  position: static;
  padding: 16px;
  border-radius: calc(var(--settings-card-radius) - var(--settings-card-padding));
}

.settings-appearance .settings-open-book {
  width: 108px;
  height: 104px;
  border-width: 3px;
}

.settings-appearance .settings-book-page {
  padding: 9px 6px;
}

.settings-appearance .settings-book-page i {
  height: 2px;
  margin-block: 5px;
}

.settings-language .settings-select-row {
  min-height: 44px;
  padding: 6px 0;
}

.settings-language :deep(.settings-select-label) {
  font-size: 13px;
  font-weight: 550;
}

.settings-language .settings-note {
  margin-top: auto;
}

.settings-grid .settings-note {
  margin: 0;
}

.settings-grid .settings-language .settings-note {
  margin-top: auto;
}

.appearance-content .settings-card-head {
  margin-bottom: 12px;
}

.appearance-content :deep(.md-segmented) {
  max-width: 520px;
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
  grid-column: 1 / -1;
  container: reading / inline-size;
}

.settings-reading-controls {
  display: grid;
  grid-template-columns: minmax(0, 2fr) repeat(2, minmax(0, 1fr));
  gap: 12px;
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

.settings-control-label {
  margin: 0 0 8px;
  font-weight: 550;
}

.settings-reading :deep(.md-segmented-option),
.appearance-content :deep(.md-segmented-option) {
  min-height: 44px;
  gap: 4px;
  padding-inline: 4px;
  white-space: normal;
  text-align: center;
}

.settings-grid :deep(.md-segmented-option svg) {
  flex: none;
  width: 14px;
  height: 14px;
}

.settings-paged-block {
  --md-segmented-disabled-opacity: 1;
  transition: opacity 200ms ease;
}

.settings-reading-controls.has-disabled-controls {
  position: relative;
  z-index: 1;
}

.has-disabled-controls .settings-paged-block {
  opacity: 0.55;
  pointer-events: none;
}

.settings-scroll-note {
  display: grid;
  grid-template-rows: 0fr;
  transition: grid-template-rows 220ms ease;
}

.settings-scroll-note.is-expanded {
  grid-template-rows: 1fr;
}

.settings-scroll-note-clip {
  min-height: 0;
  overflow: hidden;
}

.settings-scroll-note p {
  margin: 0;
  padding-top: 12px;
  color: var(--md-on-surface-variant);
  font-size: 12px;
  line-height: 1.7;
  opacity: 0;
  transform: translateY(-4px);
  transition: opacity 220ms ease, transform 220ms ease;
}

.settings-scroll-note.is-expanded p {
  opacity: 1;
  transform: translateY(0);
}

@media (prefers-reduced-motion: reduce) {
  .settings-paged-block,
  .settings-scroll-note,
  .settings-scroll-note p {
    transition: none;
  }
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
  flex-wrap: wrap;
  align-items: center;
  gap: 4px;
}

.storage-summary {
  display: flex;
  flex-wrap: wrap;
  align-items: end;
  justify-content: space-between;
  gap: 4px 12px;
}

.settings-storage .storage-number {
  font-size: 26px;
}

.settings-storage :is(.storage-stack, .storage-bar) {
  margin: 0;
}

.settings-storage .storage-legend {
  gap: 4px;
}

.settings-storage .storage-legend > div {
  font-size: 12px;
}

.settings-log-summary {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 12px;
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

.settings-card-head > .settings-badge {
  flex: none;
  border-radius: 16px;
  padding: 6px 9px;
  font-size: 12px;
  background: var(--md-primary-container);
  color: var(--md-on-primary-container);
}

.settings-card-head > .settings-badge.is-muted {
  background: var(--md-surface-high);
  color: var(--md-on-surface-variant);
}

.settings-about {
  grid-column: 1 / -1;
}

.settings-about-body {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 16px 24px;
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
  font-size: 17px;
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

.about-log-new {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--md-primary);
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

@container reading (max-width: 679px) {
  .settings-reading-controls {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .settings-reading-controls > .settings-block:first-child {
    grid-column: 1 / -1;
  }
}

@container settings (max-width: 599px) {
  .settings-grid {
    grid-template-columns: minmax(0, 1fr);
    gap: 16px;
    padding: 8px 16px 0;
  }

  .settings-card {
    --settings-card-padding: 16px;
    --settings-card-radius: 28px;
  }

  .settings-topbar-inner {
    min-height: 88px;
    padding: 18px 16px;
  }

  .settings-appearance {
    grid-template-columns: minmax(0, 1fr);
  }

  .settings-appearance .settings-book-stage {
    display: none;
  }

  .settings-footer {
    padding: 24px 20px 32px;
    font-size: 12px;
  }
}

@container reading (max-width: 359px) {
  .settings-reading-controls {
    grid-template-columns: minmax(0, 1fr);
  }
}

@container settings (max-width: 399px) {
  .settings-grid :deep(.md-segmented.has-many-options .md-segmented-icon) {
    display: none;
  }
}

@media (hover: hover) and (pointer: fine) {
  .settings-text-button:not(:disabled):hover {
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

.settings-card-open {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  min-height: 44px;
  margin: auto 0 -8px;
  padding-top: 4px;
  color: var(--md-primary);
  font-size: 13px;
  font-weight: 550;
  text-align: start;
  cursor: pointer;
}

.settings-card-open svg {
  flex: none;
  color: var(--md-on-surface-variant);
}

@media (prefers-reduced-motion: no-preference) {
  .settings-card:has(> .settings-card-open) {
    transition: scale 100ms var(--md-ease-emphasized);
  }

  .settings-card:has(> .settings-card-open:active) {
    scale: 0.985;
    transition: none;
  }
}

/* 保留整卡入口，独立控件置于点击层上方。 */
.settings-card-open::after {
  content: '';
  position: absolute;
  inset: 0;
  border-radius: var(--settings-card-radius);
}

.settings-card :is(button:not(.settings-card-open), .md-segmented) {
  position: relative;
  z-index: 1;
}

@media (hover: hover) and (pointer: fine) {
  .settings-card-open:hover svg {
    color: var(--md-primary);
  }
}

@media (hover: hover) and (pointer: fine) and (prefers-reduced-motion: no-preference) {
  .settings-card-open svg {
    transition: transform var(--md-duration-short) var(--md-ease-emphasized);
  }

  .settings-card-open:hover svg {
    transform: translateX(3px);
  }
}

.settings-back-button {
  --icon-button-background: var(--md-surface);
  display: grid;
  place-items: center;
  flex: none;
  width: 56px;
  height: 56px;
  border-radius: 50%;
  color: var(--md-on-surface);
  cursor: pointer;
  pointer-events: auto;
}

.settings-back-button svg {
  width: 29px;
  height: 29px;
}

.settings-topbar-title {
  min-width: 0;
}

.settings-topbar-actions {
  margin-left: auto;
  display: flex;
  align-items: center;
  pointer-events: auto;
}

.settings-log-actions {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  padding: 4px;
  border-radius: 999px;
  background: var(--md-surface);
}

.settings-log-action {
  display: grid;
  place-items: center;
  width: 48px;
  height: 48px;
  border-radius: 50%;
  color: var(--md-on-surface);
  cursor: pointer;
}

.settings-log-search {
  display: flex;
  align-items: center;
  gap: 10px;
  width: min(340px, 38vw);
  height: 56px;
  padding: 0 8px 0 18px;
  border-radius: 999px;
  background: var(--md-surface);
  color: var(--md-on-surface-variant);
  box-shadow: 0 6px 10px -8px color-mix(in oklab, var(--md-shadow-color-soft) 18%, transparent);
}

.settings-log-search input {
  flex: 1;
  min-width: 0;
  border: 0;
  outline: 0;
  background: transparent;
  color: var(--md-on-surface);
  font-family: inherit;
  font-size: 13px;
}

.settings-log-search input::placeholder {
  color: var(--md-on-surface-variant);
}

.settings-log-search-close {
  display: grid;
  place-items: center;
  flex: none;
  width: 40px;
  height: 40px;
  border-radius: 50%;
  color: var(--md-on-surface-variant);
  cursor: pointer;
}

.has-detail .settings-topbar-inner {
  justify-content: flex-start;
  max-width: 1036px;
  gap: 20px;
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
  display: flex;
  justify-content: center;
  align-items: center;
  gap: 52px;
  min-height: 324px;
}

.settings-surface-hero-preview {
  display: flex;
  justify-content: center;
  flex: none;
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

.settings-detail-group > h2 > svg {
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
  gap: 12px;
  width: 100%;
  min-height: var(--md-space-700);
  padding: var(--md-space-150) var(--md-space-250);
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

.settings-log-section-heading {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  column-gap: var(--md-space-150);
  margin: 0 18px var(--md-space-100);
}

.settings-log-section-heading > h2 {
  margin: 0;
  color: var(--md-on-surface-variant);
  font-size: 16px;
  font-weight: 650;
}

.settings-log-count {
  color: var(--md-on-surface-variant);
  font-size: 11px;
  font-variant-numeric: tabular-nums;
}

.settings-log-clear {
  margin-inline-start: auto;
  color: var(--md-error);
}

.settings-log-clear.is-armed {
  background: var(--md-error-container);
  color: var(--md-on-error-container);
}

.settings-log-action-note {
  margin: 0 18px var(--md-space-100);
  color: var(--md-primary);
  font-size: 12px;
}

.settings-log-panel {
  --settings-log-inset: var(--md-space-250);
}

.settings-log-filter,
.settings-log-entry,
.settings-log-empty {
  padding: var(--md-space-200) var(--settings-log-inset);
}

.settings-log-filter > .md-segmented {
  max-width: 360px;
}

.settings-log-filter :deep(.md-segmented-option) {
  min-height: 44px;
}

.settings-log-list {
  margin: 0;
  padding: 0;
  list-style: none;
}

.settings-log-entry,
.settings-log-empty {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  align-items: start;
  gap: var(--md-space-150);
  overflow-wrap: anywhere;
}

.settings-log-entry + .settings-log-entry {
  border-top: 1px solid color-mix(in oklab, var(--md-outline-variant) 65%, transparent);
}

.settings-log-marker {
  width: 32px;
  height: 32px;
  border-radius: 11px;
}

.settings-log-marker svg {
  width: 18px;
  height: 18px;
}

.settings-log-entry.is-warning .settings-log-marker {
  background: var(--md-tertiary-container);
  color: var(--md-on-tertiary-container);
}

.settings-log-entry.is-error .settings-log-marker {
  background: var(--md-error-container);
  color: var(--md-on-error-container);
}

.settings-log-meta {
  display: flex;
  align-items: baseline;
  flex-wrap: wrap;
  gap: var(--md-space-50) var(--md-space-150);
  color: var(--md-on-surface-variant);
  font-size: 11px;
}

.settings-log-time {
  font-family: var(--font-mono, ui-monospace), SFMono-Regular, Menlo, monospace;
  font-variant-numeric: tabular-nums;
  margin-inline-start: auto;
}

.settings-log-message {
  margin: 0 0 var(--md-space-50);
  color: var(--md-on-surface);
  font-size: 13px;
  font-weight: 500;
  line-height: 1.6;
}

.settings-log-detail {
  color: var(--md-primary);
  font-size: 11px;
}

.settings-log-detail summary {
  display: flex;
  align-items: center;
  gap: var(--md-space-50);
  width: fit-content;
  min-height: 44px;
  cursor: pointer;
  list-style: none;
}

.settings-log-detail summary::-webkit-details-marker {
  display: none;
}

.settings-log-detail[open] summary svg {
  transform: rotate(180deg);
}

.settings-log-detail pre {
  max-height: 220px;
  overflow: auto;
  margin: 0;
  padding: var(--md-space-150);
  border-radius: 14px;
  background: var(--md-surface-high);
  color: var(--md-on-surface);
  font-family: var(--font-mono, ui-monospace), SFMono-Regular, Menlo, monospace;
  font-size: 11px;
  line-height: 1.55;
  white-space: pre-wrap;
}

.settings-log-empty {
  align-items: center;
}

.settings-log-empty b {
  font-size: 13px;
  font-weight: 600;
}

.settings-log-empty p {
  margin: var(--md-space-50) 0 0;
  color: var(--md-on-surface-variant);
  font-size: 12px;
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
  margin: 0;
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
  padding: var(--md-space-150) var(--md-space-250);
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

.settings-detail-hero-heading {
  display: flex;
  align-items: center;
  gap: var(--md-space-200);
}

.settings-detail-hero-heading h2 {
  margin: 0;
  font-size: 22px;
  font-weight: 650;
  letter-spacing: -0.025em;
}

.settings-debug-switch-label {
  display: flex;
  align-items: center;
  gap: var(--md-space-150);
}

.settings-logs-hero {
  display: grid;
  grid-template-columns: minmax(0, 1fr) min(50%, 360px);
  align-items: center;
  gap: var(--md-space-300);
}

.settings-detail-hero-icon {
  display: grid;
  place-items: center;
  flex: none;
  width: 52px;
  height: 52px;
  border-radius: 18px;
  background: var(--md-primary-container);
  color: var(--md-on-primary-container);
}

.settings-detail-hero-icon :deep(svg) {
  width: 25px;
  height: 25px;
}

.settings-logs-summary {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  margin: 0;
}

.settings-logs-summary > div {
  display: grid;
  gap: var(--md-space-50);
  padding-inline: var(--md-space-150);
  text-align: center;
}

.settings-logs-summary > div + div {
  border-inline-start: 1px solid var(--md-outline-variant);
}

.settings-logs-summary dt {
  color: var(--md-on-surface-variant);
  font-size: 12px;
}

.settings-logs-summary dd {
  margin: 0;
  font-size: 16px;
  font-weight: 650;
  font-variant-numeric: tabular-nums;
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
  button.settings-list-row:not([role="switch"]):hover {
    background: color-mix(in oklab, var(--md-primary) 4%, transparent);
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

  .settings-log-actions {
    gap: 3px;
    padding: 2px;
  }

  .settings-log-action {
    width: 42px;
    height: 42px;
  }

  .settings-log-search {
    flex: 1;
    width: auto;
    height: 46px;
    padding-left: 14px;
  }

  .is-log-searching .settings-topbar-title {
    display: none;
  }

  .is-log-searching .settings-topbar-actions {
    flex: 1;
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

  .settings-surface-hero {
    gap: 28px;
    min-height: 296px;
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
    padding-inline: var(--md-space-200);
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
    padding-inline: var(--md-space-200);
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

  .settings-about-body {
    flex-direction: column;
    align-items: flex-start;
    gap: 12px;
  }

  .settings-surface-hero {
    flex-direction: column;
    gap: 18px;
    min-height: 0;
    text-align: center;
  }

  .settings-surface-hero .settings-hero-copy {
    max-width: none;
  }

  .settings-surface-hero .settings-hero-copy h2 {
    margin-top: 14px;
  }
}

@container settings (max-width: 599px) {
  .settings-logs-hero {
    grid-template-columns: minmax(0, 1fr);
    gap: var(--md-space-200);
  }

  .settings-detail-hero-icon {
    width: 46px;
    height: 46px;
    border-radius: 16px;
  }

  .settings-logs-summary {
    padding-top: var(--md-space-200);
    border-top: 1px solid var(--md-outline-variant);
  }

  .settings-log-section-heading > h2 {
    font-size: 15px;
  }

  .settings-log-panel {
    --settings-log-inset: var(--md-space-200);
  }

  .settings-log-filter > .md-segmented {
    max-width: none;
  }

  .settings-log-time {
    margin-inline-start: 0;
  }
}
</style>
