import React from 'react';
import { Text, View } from 'react-native';
import Svg, { Circle, Line, Path, Text as SvgText } from 'react-native-svg';
import { useMobileTheme } from './MobileAppearance.jsx';
const colors=['#b8a3e5','#87b1b1','#d9b18d','#83a4c6','#bd97ab','#a3ad91'];
const text={color:'#ece8f3',fontSize:14,lineHeight:21};
export default function MobileCharts({rows,from,to}) {
  const { accent } = useMobileTheme();
  const hourly=from===to;
  const keys=hourly?Array.from({length:24},(_,i)=>i):[...new Set(rows.map(r=>r.day))].sort();
  const values=keys.map(key=>hourly?rows.reduce((n,r)=>n+(Number(r.hourly?.[key])||0),0):rows.filter(r=>r.day===key).reduce((n,r)=>n+r.seconds,0));
  const max=Math.max(60,...values);const width=300,height=190;
  const points=values.map((value,i)=>`${34+i/Math.max(1,values.length-1)*250},${164-value/max*140}`);
  return <View style={{gap:20}}>
    <Text style={text}>{hourly?'Hourly usage':'Usage by recorded day'}</Text>
    <Svg width="100%" height={height} viewBox={`0 0 ${width} ${height}`} accessibilityLabel={hourly?'Hourly usage line chart':'Daily usage line chart'}>
      {[0,.5,1].map(t=><React.Fragment key={t}><Line x1={34} x2={284} y1={164-t*140} y2={164-t*140} stroke="#ffffff26"/><SvgText x={28} y={168-t*140} fill="#ded8e8" textAnchor="end" fontSize={9}>{Math.round(max*t/60)}m</SvgText></React.Fragment>)}
      {points.length>0&&<Path d={'M'+points.join(' L')} fill="none" stroke={accent} strokeWidth={2.5}/>}
      <SvgText x={34} y={184} fill="#ded8e8" fontSize={10}>{hourly?'00:00':from}</SvgText><SvgText x={284} y={184} textAnchor="end" fill="#ded8e8" fontSize={10}>{hourly?'23:00':to}</SvgText>
    </Svg>
    {['app','website'].map(kind=>{
      const groups=new Map();for(const row of rows.filter(r=>r.kind===kind))groups.set(row.name,(groups.get(row.name)||0)+row.seconds);
      const entries=[...groups].sort((a,b)=>b[1]-a[1]);const slices=entries.slice(0,5);if(entries.length>5)slices.push(['Other',entries.slice(5).reduce((n,r)=>n+r[1],0)]);
      const total=slices.reduce((n,r)=>n+r[1],0);let angle=-Math.PI/2;
      return <View key={kind} style={{gap:10}}><Text style={[text,{fontWeight:'700'}]}>{kind==='app'?'App usage':'Website usage'}</Text>{total>0?<><Svg width="100%" height={164} viewBox="0 0 180 164" accessibilityLabel={`${kind} usage pie chart`}>{slices.map(([name,value],i)=>{const start=angle;angle+=value/total*Math.PI*2;const x1=90+70*Math.cos(start),y1=82+70*Math.sin(start),x2=90+70*Math.cos(angle),y2=82+70*Math.sin(angle);return value===total?<Circle key={name} cx={90} cy={82} r={70} fill={colors[i]}/>:<Path key={name} d={`M90,82 L${x1},${y1} A70,70 0 ${value/total>.5?1:0},1 ${x2},${y2} Z`} fill={colors[i]} stroke="#231b30" strokeWidth={1.5}/>;})}</Svg>{slices.map(([name,value],i)=><View key={name} style={{flexDirection:'row',gap:8,alignItems:'center'}}><View style={{height:9,width:9,borderRadius:2,backgroundColor:colors[i]}}/><Text style={[text,{flex:1}]} numberOfLines={1}>{name}</Text><Text style={text}>{Math.round(value/total*100)}%</Text></View>)}</>:<Text style={text}>No recorded activity in this range.</Text>}</View>;
    })}
  </View>;
}
