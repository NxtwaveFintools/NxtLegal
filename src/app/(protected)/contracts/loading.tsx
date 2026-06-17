import styles from '@/modules/contracts/ui/contracts-workspace.module.css'

export default function ContractsLoading() {
  return (
    <div className={styles.layout}>
      <aside className={styles.sidebar}>
        <div className={styles.list}>
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className={styles.shimmerBlock}>
              <div className={styles.shimmerLine} style={{ width: `${50 + i * 10}%` }} />
              <div className={styles.shimmerLine} style={{ width: '35%', height: 10 }} />
            </div>
          ))}
        </div>
      </aside>
      <section className={styles.detail}>
        <div style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div className={styles.shimmerBlock}>
            <div className={styles.shimmerLine} style={{ width: '30%' }} />
            <div className={styles.shimmerLine} style={{ width: '60%' }} />
          </div>
          <div className={styles.shimmerBlock}>
            <div className={styles.shimmerLine} style={{ width: '18%' }} />
            <div className={styles.shimmerLine} style={{ width: '95%' }} />
            <div className={styles.shimmerLine} style={{ width: '86%' }} />
          </div>
          <div className={styles.shimmerBlock}>
            <div className={styles.shimmerLine} style={{ width: '22%' }} />
            <div className={styles.shimmerLine} style={{ width: '78%' }} />
            <div className={styles.shimmerLine} style={{ width: '65%' }} />
          </div>
        </div>
      </section>
    </div>
  )
}
