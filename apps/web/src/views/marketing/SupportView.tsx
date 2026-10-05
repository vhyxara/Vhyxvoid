'use client'

import Link from 'next/link'

import { Button } from '@vhyxui/react'

import styles from './marketing.module.css'

export function SupportView({ email, docsUrl, statusUrl }: { email: string; docsUrl: string; statusUrl?: string }) {
  return (
    <section className={styles.section}>
      <div className={`${styles.inner} ${styles.center}`}>
        <span className={styles.eyebrow}>Support</span>
        <h1 className={styles.h2}>How can we help?</h1>
        <p className={styles.lead}>Most answers are in the documentation. For anything else, email us and a person will reply.</p>
        <div className={styles.cards} style={{ textAlign: 'start' }}>
          <div className={styles.card}>
            <h3>Documentation</h3>
            <p>Quickstart, framework integrations, troubleshooting and the API reference.</p>
            <div style={{ marginBlockStart: 16 }}>
              <Button asChild variant='outline' size='sm'>
                <Link href={docsUrl}>Open the docs</Link>
              </Button>
            </div>
          </div>
          <div className={styles.card}>
            <h3>Email</h3>
            <p>Account, billing and technical questions. Include your account slug if you have one.</p>
            <div style={{ marginBlockStart: 16 }}>
              <Button asChild size='sm'>
                <a href={`mailto:${email}`}>{email}</a>
              </Button>
            </div>
          </div>
          {statusUrl && (
            <div className={styles.card}>
              <h3>Status</h3>
              <p>Live availability of the hub, API and dashboard.</p>
              <div style={{ marginBlockStart: 16 }}>
                <Button asChild variant='outline' size='sm'>
                  <a href={statusUrl}>View status</a>
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>
    </section>
  )
}
