<template>
  <main class="chat-area">
    <section class="chat-frame">
      <header class="chat-topbar">
        <div class="chat-topbar-main">
          <span class="chat-kicker">Iris Control Center</span>
          <h2>AI Agent 对话控制台</h2>
        </div>
        <p class="chat-topbar-note">支持流式推理、工具执行与多会话编排</p>
      </header>

      <MessageList
        :messages="messages"
        :sending="sending"
        :streaming-text="streamingText"
        :is-streaming="isStreaming"
        @retry="retryLastMessage"
      />
      <ChatInput :disabled="sending" @send="sendMessage" />
    </section>
  </main>
</template>

<script setup lang="ts">
import { useChat } from '../composables/useChat'
import MessageList from '../components/MessageList.vue'
import ChatInput from '../components/ChatInput.vue'

const { messages, sending, streamingText, isStreaming, sendMessage, retryLastMessage } = useChat()
</script>
