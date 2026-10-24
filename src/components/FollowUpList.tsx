import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { NOTE_KIND_LABEL, type CustomerNote } from '../lib/customers'
import { supabase } from '../lib/supabase'
import { formatDay, isoDate } from '../lib/types'

type Row = CustomerNote & { customers: { name: string; customer_number: string } | null }

// Offene Wiedervorlagen des angemeldeten Benutzers (überfällige zuerst)
export function FollowUpList({ me }: { me: string }) {
  const [rows, setRows] = useState<Row[]>([])
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    const { data } = await supabase
      .from('customer_notes')
      .select('*, customers(name, customer_number)')
      .eq('follow_up_user', me)
      .is('follow_up_done_at', null)
      .not('follow_up_date', 'is', null)
      .order('follow_up_date')
    setRows((data ?? []) as Row[])
  }, [me])

  useEffect(() => {
    load()
  }, [load])

  async function done(id: number) {
    setBusy(true)
    await supabase.from('customer_notes').update({ follow_up_done_at: new Date().toISOString() }).eq('id', id)
    await load()
    setBusy(false)
  }

  if (rows.length === 0) return null
  const today = isoDate(new Date())
  return (
    <section className="card follow-ups">
      <h2>Meine Wiedervorlagen</h2>
      <ul className="history">
        {rows.map((n) => {
          const due = n.follow_up_date! <= today
          return (
            <li key={n.id} className="follow-up-row">
              <div>
                <span className={due ? 'follow-up-due' : 'muted'}>
                  {n.follow_up_date! < today ? 'Überfällig seit ' : n.follow_up_date === today ? 'Heute · ' : ''}
                  {formatDay(n.follow_up_date!)}
                </span>
                <div>
                  <Link to={`/kunden/${n.customer_id}`}>
                    {n.customers?.customer_number} {n.customers?.name}
                  </Link>
                  {' · '}
                  {NOTE_KIND_LABEL[n.kind]}
                  {n.subject && `: ${n.subject}`}
                </div>
              </div>
              <button disabled={busy} onClick={() => done(n.id)}>✓ Erledigt</button>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
