'use strict';
require('file-loader?name=[name].[ext]!./index.html');
require('./css/photon.css');
require('./css/font-awesome.min.css');
import Promise from 'bluebird';
import EventEmitter from 'events';
import os from 'os';
import path from 'path';
import {spawn, execFile} from 'child_process';
import readline from 'readline';
import {PassThrough} from 'stream';
import React, {PureComponent} from 'react';
import electron from 'electron';
import ReactDOM from 'react-dom';
import shortid from 'shortid';

const RN_CLI = 'node_modules/react-native/local-cli/cli.js';

class ConsoleStream extends EventEmitter {
    start(...args){
        return new Promise((resolve, reject)=>{
            let child = this.child = spawn(...args);
            let {pid} = child;
            electron.ipcRenderer.send('spawn', pid);
            let stream = new PassThrough();
            child.stdout.pipe(stream, {end: false});
            child.stderr.pipe(stream, {end: false});
            let rl = this.rl = readline.createInterface({input: stream});
            child.on('close', (code, signal)=>{
                electron.ipcRenderer.send('spawn', -pid);
                rl.close();
                delete this.child;
                delete this.rl;
                resolve({code, signal});
                this.emit('close', code, signal);
            }).on('error', err=>{
                reject(err);
                this.emit('error', err);
            });
            rl.on('line', data=>{
                console.log(data);
                this.emit('line', data, shortid.generate());
            });
        });
    }

    stop(signal = 'SIGINT'){
        if (this.child)
            this.child.kill(signal);
    }
}

class App extends PureComponent {
    constructor(props){
        super(props);
        this.state = {
            dir: localStorage.dir,
            tab: 0,
            tabs: ['Console', 'Build', 'Packager'].map((title, i)=>({title, history: [],
                onClick: this.onTab.bind(this, i)})),
        };
    }

    componentDidMount(){
        let {dir} = this.state;
        document.title = dir||document.title;
        if (!dir)
            this.open();
    }

    onTab = tab=>this.setState({tab});

    open = ()=>{
        if (this.state.streams)
            return;
        let dir = (electron.remote.dialog.showOpenDialog({properties: ['openDirectory']})||[])[0];
        if (!dir)
            return;
        this.setState({dir}, ()=>document.title = localStorage.dir = dir);
    };

    start = async ()=>{
        let {dir} = this.state;
        const startPackager = ()=>new Promise((resolve, reject)=>{
            let packager = new ConsoleStream();
            packager.on('close', ()=>{
                this.stop();
                resolve();
            }).on('line', (data, id)=>{
                let {tabs} = this.state;
                this.setState({tabs: [tabs[0], tabs[1],
                    {...tabs[2], history: [].concat(tabs[2].history, {data, id})}]});
                if (data.startsWith('React packager ready.'))
                    resolve(packager);
            }).on('error', reject);
            let {tabs} = this.state;
            this.setState({
                streams: {packager},
                tabs: [tabs[0], {...tabs[1], history: []}, {...tabs[2], history: []}],
            }, ()=>packager.start('node', [RN_CLI, 'start'], {cwd: dir}));
        });
        const startBuild = ()=>new Promise((resolve, reject)=>{
            let build = new ConsoleStream(), udid;
            build.on('line', (data, id)=>{
                let {tabs} = this.state;
                this.setState({tabs: [tabs[0], {...tabs[1], history: [].concat(tabs[1].history, {data, id})},
                    tabs[2]]});
                let m = data.match(/^Building using.*?-destination id=([^ ]+)/);
                if (m)
                    udid = m[1];
            }).on('error', reject);
            this.setState({streams: {...this.state.streams, build}},
                ()=>build.start('node', [RN_CLI, 'run-ios', '--no-packager'], {cwd: dir})
                .then(({code, signal})=>this.setState({streams: {...this.state.streams, build: undefined}},
                        ()=>resolve(code || signal ? null : udid)))
                .catch(reject));
        });
        const startSyslog = async udid=>{
            if (!udid)
            {
                udid = []
                    .concat(...Object.values(JSON.parse(await Promise.promisify(execFile)('xcrun',
                                    ['simctl', 'list', '--json', 'devices'], {encoding: 'utf8'})).devices))
                    .reduce((res, {state, udid})=>res || state=='Booted' && udid, null);
            }
            return new Promise((resolve, reject)=>{
                let syslog = new ConsoleStream();
                syslog.on('line', (data, id)=>{
                    let {tabs} = this.state;
                    this.setState({tabs: [{...tabs[0], history: [].concat(tabs[0].history, {data, id})}, tabs[1],
                        tabs[2]]});
                }).on('error', reject);
                this.setState({streams: {...this.state.streams, syslog}}, ()=>{
                    syslog.start('syslog', ['-w', '-F', 'std', '-d',
                        path.join(os.homedir(), 'Library', 'Logs', 'CoreSimulator', udid, 'asl')]);
                    resolve(syslog);
                });
            });
        };
        let packager = await startPackager();
        if (!packager)
            return;
        let udid = await startBuild();
        if (!udid)
            return packager.stop();
        await startSyslog(udid);
    };

    stop = ()=>{
        let {streams} = this.state;
        if (!streams)
            return;
        for (let name in streams)
        {
            if (streams[name])
                streams[name].stop();
        }
        this.setState({streams: null});
    };

    render(){
        let {dir, tab, tabs, streams} = this.state;
        return (
            <div className='window'>
                <header className='toolbar toolbar-header'>
                    <div className='toolbar-actions'>
                        <button
                            className='btn btn-default'
                            title='Open'
                            disabled={streams ? 'disabled' : false}
                            onClick={this.open}
                        >
                            <span className='icon icon-folder'></span>
                        </button>
                        <div className='btn-group'>
                            <button
                                className='btn btn-default'
                                title='Debug'
                                disabled={dir && !streams ? false : 'disabled'}
                                onClick={this.start}
                            >
                                <span className='icon'><i className='fa fa-play' /></span>
                            </button>
                            <button
                                className='btn btn-default'
                                title='Stop Debug'
                                disabled={streams ? false : 'disabled'}
                                onClick={this.stop}
                            >
                                <span className='icon'><i className='fa fa-stop' /></span>
                            </button>
                        </div>
                    </div>
                </header>
                <div className='window-content'>
                    <div className='pane-group'>
                        <div className='pane'>
                            <div className='tab-group'>
                                {tabs.map((t, i)=>
                                    <div
                                        key={i}
                                        className={'tab-item'+(tab==i ? ' active' : '')}
                                        onClick={t.onClick}
                                    >{t.title}</div>)}
                                </div>
                                <div className='console'>
                                    {tabs[tab].history.map(({id, data})=>(<div key={id}>{data}</div>))}
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
        );
    }
}

ReactDOM.render(<App />, document.getElementById('root'));
