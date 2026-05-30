/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */
import React, { useState } from 'react';
import Layout from './components/Layout';
import Chat from './components/Chat';
import Dreams from './components/Dreams';
import Awake from './components/Awake';
import Settings from './components/Settings';

export default function App() {
  const [activeTab, setActiveTab] = useState<'chat' | 'dreams' | 'awake' | 'settings'>('chat');

  return (
    <Layout activeTab={activeTab} setActiveTab={setActiveTab}>
      {activeTab === 'chat' && <Chat />}
      {activeTab === 'dreams' && <Dreams />}
      {activeTab === 'awake' && <Awake />}
      {activeTab === 'settings' && <Settings />}
    </Layout>
  );
}
