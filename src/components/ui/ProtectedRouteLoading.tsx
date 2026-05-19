import styles from './ProtectedRouteLoading.module.css'

type ProtectedRouteLoadingProps = {
  title: string
  mode?: 'dashboard' | 'repository' | 'contracts'
}

const cardItems = [0, 1, 2, 3]
const tableRows = [0, 1, 2, 3, 4, 5]
const contractRailItems = [0, 1, 2, 3, 4]
const contractSummaryRows = [0, 1, 2, 3, 4]

export default function ProtectedRouteLoading({ title, mode = 'dashboard' }: ProtectedRouteLoadingProps) {
  return (
    <div className={styles.page} aria-busy="true" aria-live="polite" aria-label={title}>
      <aside className={styles.sidebar}>
        <div className={styles.logoPulse} />
        <div className={styles.navStack}>
          <div className={`${styles.navDot} ${styles.navDotActive}`} />
          <div className={styles.navDot} />
          <div className={styles.navDot} />
        </div>
        <div className={styles.navBottom}>
          <div className={styles.navDot} />
          <div className={styles.avatarDot} />
        </div>
      </aside>

      <div className={styles.content}>
        <header className={styles.topbar}>
          <div className={styles.topbarSpacer} />
          <div className={styles.topbarCluster}>
            <div className={styles.circle} />
            <div className={styles.pillWide} />
            <div className={styles.pillMedium} />
            <div className={styles.avatarDot} />
          </div>
        </header>

        <main className={styles.main}>
          <section className={styles.hero}>
            <div className={styles.titleBlock}>
              <div className={styles.kicker}>{title}</div>
              <div className={styles.titleLine} />
              <div className={styles.subtitleLine} />
            </div>
            {mode === 'dashboard' ? (
              <div className={styles.cardGrid}>
                {cardItems.map((item) => (
                  <div key={item} className={styles.card}>
                    <div className={styles.cardTopLine} />
                    <div className={styles.cardBottomLine} />
                  </div>
                ))}
              </div>
            ) : mode === 'repository' ? (
              <div className={styles.filterGrid}>
                <div className={styles.filterPill} />
                <div className={styles.filterPill} />
                <div className={styles.filterPill} />
                <div className={styles.filterPillShort} />
              </div>
            ) : (
              <div className={styles.contractHero}>
                <div className={styles.filterPill} />
                <div className={styles.filterPillShort} />
                <div className={styles.filterPill} />
              </div>
            )}
          </section>

          {mode === 'contracts' ? (
            <section className={styles.contractWorkbench}>
              <aside className={styles.contractRail}>
                <div className={styles.contractRailHeader} />
                <div className={styles.contractRailList}>
                  {contractRailItems.map((item) => (
                    <div key={item} className={styles.contractRailCard}>
                      <div className={styles.contractRailCardTitle} />
                      <div className={styles.contractRailCardMeta} />
                    </div>
                  ))}
                </div>
              </aside>

              <div className={styles.contractPane}>
                <div className={styles.contractPaneHeader}>
                  <div className={styles.contractPaneTitle} />
                  <div className={styles.contractPaneActions}>
                    <div className={styles.statusPill} />
                    <div className={styles.buttonGhost} />
                  </div>
                </div>

                <div className={styles.contractPaneTabs}>
                  <div className={styles.tabActive} />
                  <div className={styles.tab} />
                  <div className={styles.tab} />
                  <div className={styles.tabShort} />
                </div>

                <div className={styles.contractPaneBody}>
                  <div className={styles.contractSummaryColumn}>
                    {contractSummaryRows.map((row) => (
                      <div key={row} className={styles.contractSummaryRow} />
                    ))}
                  </div>

                  <div className={styles.contractDetailColumn}>
                    {tableRows.slice(0, 4).map((row) => (
                      <div key={row} className={styles.contractDetailCard}>
                        <div className={styles.rowTitle} />
                        <div className={styles.rowMeta} />
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </section>
          ) : (
            <section className={styles.panel}>
              <div className={styles.panelHeader}>
                <div className={styles.panelTitle} />
                <div className={styles.panelAction} />
              </div>
              <div className={styles.tabs}>
                <div className={styles.tabActive} />
                <div className={styles.tab} />
                <div className={styles.tab} />
                <div className={styles.tabShort} />
              </div>
              <div className={styles.rows}>
                {tableRows.map((row) => (
                  <div key={row} className={styles.row}>
                    <div className={styles.rowMain}>
                      <div className={styles.rowTitle} />
                      <div className={styles.rowMeta} />
                    </div>
                    <div className={styles.rowActions}>
                      <div className={styles.statusPill} />
                      <div className={styles.buttonGhost} />
                      <div className={styles.buttonGhost} />
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}
        </main>
      </div>
    </div>
  )
}
