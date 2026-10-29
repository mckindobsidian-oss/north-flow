import React, { useEffect, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import AuthScreen from './AuthScreen.jsx';
import MobileMain from './MobileMain.jsx';
import { restoreSession, onAuthChange, signOut } from './lib/auth.js';
export default function MobileRoot() {
  const [user,setUser]=useState(null);const [booting,setBooting]=useState(true);
  useEffect(()=>{
    let alive=true;
    restoreSession().then(value=>{if(alive)setUser(value);}).catch(()=>{}).finally(()=>{if(alive)setBooting(false);});
    const stop=onAuthChange(value=>{if(alive)setUser(value);});
    return()=>{alive=false;stop();};
  },[]);
  if(booting)return <View style={{flex:1,backgroundColor:'#171121',alignItems:'center',justifyContent:'center'}}><ActivityIndicator color="#c3b0ff" size="large"/></View>;
  if(!user)return <AuthScreen dark onAuthed={setUser}/>;
  return <SafeAreaProvider><MobileMain key={user.id||user.un} user={user} onLogout={async()=>{await signOut();setUser(null);}}/></SafeAreaProvider>;
}
