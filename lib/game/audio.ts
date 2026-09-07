export class GameAudio {
  context:AudioContext|null=null;
  enabled=true;
  init(){if(!this.context)this.context=new AudioContext();void this.context.resume();}
  tone(freq:number,duration:number,volume=.08,type:OscillatorType='sine'){
    if(!this.enabled||!this.context)return;
    const c=this.context,o=c.createOscillator(),g=c.createGain();
    o.type=type;o.frequency.setValueAtTime(freq,c.currentTime);o.frequency.exponentialRampToValueAtTime(freq*.35,c.currentTime+duration);
    g.gain.setValueAtTime(volume,c.currentTime);g.gain.exponentialRampToValueAtTime(.001,c.currentTime+duration);
    o.connect(g).connect(c.destination);o.start();o.stop(c.currentTime+duration);
  }
  shot(enemy=false){
    if(!this.enabled||!this.context)return;
    const c=this.context,b=c.createBuffer(1,c.sampleRate*.13,c.sampleRate),data=b.getChannelData(0);
    for(let i=0;i<data.length;i++)data[i]=(Math.random()*2-1)*Math.pow(1-i/data.length,3);
    const s=c.createBufferSource(),g=c.createGain(),f=c.createBiquadFilter();
    s.buffer=b;f.type='lowpass';f.frequency.value=enemy?900:2600;g.gain.value=enemy?.09:.24;
    s.connect(f).connect(g).connect(c.destination);s.start();this.tone(enemy?90:140,.12,enemy?.025:.1,'triangle');
  }
  step(){this.tone(75,.05,.026,'triangle');}
  hit(){this.tone(1050,.055,.05,'triangle');}
  kill(){this.tone(680,.16,.06,'sine');}
  reload(){this.tone(340,.09,.05,'square');}
  dispose(){void this.context?.close();}
}
