import { useCallback, useEffect, useState } from 'react'
import { supabase } from './supabase'

export interface Article {
  id: number
  article_number: string
  description: string
  unit: string
  price: number | null
  active: boolean
}

export function articleLabel(a: Article) {
  return a.article_number ? `${a.article_number} – ${a.description}` : a.description
}

export function useArticles(includeInactive = false) {
  const [articles, setArticles] = useState<Article[]>([])
  const reload = useCallback(async () => {
    let q = supabase.from('articles').select('*').order('article_number').order('description')
    if (!includeInactive) q = q.eq('active', true)
    const { data } = await q
    setArticles((data ?? []) as Article[])
  }, [includeInactive])
  useEffect(() => {
    reload()
  }, [reload])
  return { articles, reload }
}
