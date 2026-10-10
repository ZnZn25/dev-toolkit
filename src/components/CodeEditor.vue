<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import * as monaco from 'monaco-editor/editor/editor.api'
import 'monaco-editor/editor/contrib/codelens/browser/codeLensCache'
import 'monaco-editor/editor/contrib/inlayHints/browser/inlayHintsController'
import 'monaco-editor/editor/common/services/treeViewsDndService'
import 'monaco-editor/editor/contrib/suggest/browser/suggestMemory'
import 'monaco-editor/platform/actionWidget/browser/actionWidget'
import EditorWorker from 'monaco-editor/editor/editor.worker?worker'
import JsonWorker from 'monaco-editor/language/json/json.worker?worker'
import 'monaco-editor/language/json/monaco.contribution'
import 'monaco-editor/languages/definitions/sql/register'

type Props = { modelValue: string; language: 'json' | 'sql' | 'plaintext'; readOnly?: boolean; theme: 'dark' | 'light'; fontSize: number; indentStyle: '2' | '4' | 'tab' }
const props = withDefaults(defineProps<Props>(), { readOnly: false, fontSize: 13, indentStyle: '2' })
const emit = defineEmits<{ 'update:modelValue': [value: string] }>()
const host = ref<HTMLDivElement>()
let editor: monaco.editor.IStandaloneCodeEditor | undefined

;(self as typeof self & { MonacoEnvironment?: { getWorker: (_id: string, label: string) => Worker } }).MonacoEnvironment = {
  getWorker: (_id, label) => label === 'json' ? new JsonWorker() : new EditorWorker(),
}

onMounted(() => {
  if (!host.value) return
  editor = monaco.editor.create(host.value, {
    value: props.modelValue,
    language: props.language,
    theme: props.theme === 'dark' ? 'vs-dark' : 'vs',
    readOnly: props.readOnly,
    automaticLayout: true,
    minimap: { enabled: false },
    fontFamily: 'Cascadia Code, Consolas, "Courier New", monospace',
    fontSize: props.fontSize,
    lineHeight: 22,
    lineNumbersMinChars: 3,
    padding: { top: 14, bottom: 12 },
    scrollBeyondLastLine: false,
    wordWrap: 'on',
    wrappingIndent: 'indent',
    folding: true,
    renderWhitespace: 'selection',
    bracketPairColorization: { enabled: true },
    tabSize: props.indentStyle === 'tab' ? 1 : Number(props.indentStyle),
    insertSpaces: props.indentStyle !== 'tab',
    smoothScrolling: true,
    cursorBlinking: 'smooth',
    guides: { indentation: true, bracketPairs: true },
    overviewRulerBorder: false,
    scrollbar: { verticalScrollbarSize: 8, horizontalScrollbarSize: 8 },
    contextmenu: true,
  })
  editor.onDidChangeModelContent(() => emit('update:modelValue', editor?.getValue() ?? ''))
})

watch(() => props.modelValue, (value) => {
  if (!editor || editor.getValue() === value) return
  editor.setValue(value)
})
watch(() => props.language, (language) => { if (editor) monaco.editor.setModelLanguage(editor.getModel()!, language) })
watch(() => props.indentStyle, (style) => editor?.updateOptions({ tabSize: style === 'tab' ? 1 : Number(style), insertSpaces: style !== 'tab' }))
watch(() => props.fontSize, (fontSize) => editor?.updateOptions({ fontSize }))

watch(() => props.theme, (theme) => {
  if (!editor) return
  monaco.editor.setTheme(theme === 'dark' ? 'vs-dark' : 'vs')
})

onBeforeUnmount(() => editor?.dispose())

defineExpose({
  focus: () => editor?.focus(),
  hasTextFocus: () => editor?.hasTextFocus() ?? false,
})
</script>

<template><div ref="host" class="editor-host" :class="{ 'editor-readonly': readOnly }" /></template>
