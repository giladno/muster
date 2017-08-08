'use strict';
require('./css/style.less');
import Promise from 'bluebird';
import EventEmitter from 'events';
import os from 'os';
import path from 'path';
import child_process, {spawn} from 'child_process';
import readline from 'readline';
import {PassThrough} from 'stream';
import React, {PureComponent} from 'react';
import {LocaleProvider, Layout, Menu, Button, Row, Col} from 'antd';
import {Icon} from 'react-fa';
import electron from 'electron';
import shortid from 'shortid';
import enUS from 'antd/lib/locale-provider/en_US';
import Checklist from './checklist.jsx';
import FileTree from './filetree.jsx';

const execFile = Promise.promisify(child_process.execFile);

const RN_CLI = 'node_modules/react-native/local-cli/cli.js';

class ConsoleStream extends EventEmitter {
    constructor(opt = {}){
        super();
        Object.assign(this, opt);
    }

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

    stop(signal){
        signal = signal||this.signal||'SIGTERM';
        if (this.child)
            this.child.kill(signal);
    }
}

class Inspector extends PureComponent {
    id = 'inspector';

    componentDidMount(){
        this.start();
    }

    componentWillUnmount(){
        this.stop();
    }

    start(){
        if (this.server)
            return;
        if (!this.inspector)
            this.inspector = require('react-devtools-core/standalone');
        this.server = this.inspector
            .setBrowserName('Muster')
            .setStatusListener(status=>console.log(status))
            .setContentDOMNode(document.getElementById(this.id))
            .startServer(8097);
    }

    stop(){
        if (!this.server)
            return;
        this.server.close();
        delete this.server;
    }

    render(){
        return (
            <div id={this.id}>
                <div id='waiting'>
                    <h2>Waiting for a connection...</h2>
                </div>
            </div>
        );
    }
}

const ToolbarButton = ({icon, disabled, ...props})=>(
    <Col span={2}>
        {icon && <Button size='large' shape='circle' disabled={disabled && 'disabled' || false} {...props}>
            <Icon name={icon} />
        </Button>}
    </Col>
);

export default class extends PureComponent {
    constructor(props){
        super(props);
        let his = [];
        for (let i=0;i<300;i++)
            his.push({id: ''+i, data: ''+i});
        this.state = {
            dir: localStorage.dir,
            tab: '2',
            tabs: ['Console', 'Build', 'Packager'].map((title, index)=>({title, history: [...his],
                render: ()=>this.renderConsole(this.state.tabs[index])})).concat({title: 'Inspector',
                    render: ()=><Inspector />}).map((tab, key)=>({...tab, key})),
            autoscroll: true,
        };
    }

    onScroll = ()=>{
        if (this._scroll)
            return;
        this._scroll = true;
        window.requestAnimationFrame(()=>{
            let {body} = document;
            this.setState({autoscroll: body.scrollTop>=body.scrollHeight-body.clientHeight});
            this._scroll = false;
        });
    };

    componentDidMount(){
        let {dir} = this.state;
        document.title = dir||document.title;
        if (!dir)
            this.open();
        window.addEventListener('scroll', this.onScroll);
    }

    componentDidUpdate(prevProps, prevState){
        let {autoscroll, tabs, tab} = this.state;
        let {body} = document;
        tab = +tab;
        if (autoscroll && (tab!=(+prevState.tab) || tabs[tab]!==prevState.tabs[tab]))
            body.scrollTop = body.scrollHeight;
    }

    onTab = ({key})=>this.setState({tab: key});

    open = ()=>{
        if (this.state.streams)
            return;
        let {dialog, getCurrentWindow} = electron.remote;
        dialog.showOpenDialog(getCurrentWindow(), {properties: ['openDirectory']}, ([dir] = [])=>{
            if (!dir)
                return;
            this.setState({dir}, ()=>{
                document.title = localStorage.dir = dir;
                this.checklist(dir);
            });
        });
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
                    .concat(...Object.values(JSON.parse(await execFile('xcrun', ['simctl', 'list', '--json',
                        'devices'], {encoding: 'utf8'})).devices))
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
        const startDebugger = ()=>new Promise((resolve, reject)=>{
            this.ws = new WebSocket('ws://localhost:8081/debugger-proxy?role=debugger&name=Muster');
            this.ws.addEventListener('open', resolve);
            this.ws.addEventListener('error', reject);
            this.ws.addEventListener('close', ()=>{
                if (!this.worker)
                    return;
                this.worker.terminate();
                delete this.worker;
            });
            this.ws.addEventListener('message', msg=>{
                if (!msg.data)
                    return;
                let data = JSON.parse(msg.data);
                if (data.method=='prepareJSRuntime')
                {
                    if (this.worker)
                        this.worker.terminate();
                    this.worker = new Worker('worker.js');
                    this.worker.onmessage = ({data})=>{
                        if (!data.muster)
                            return this.ws.send(JSON.stringify(data));
                    };
                    this.ws.send(JSON.stringify({replyID: data.id}));
                }
                else if (data.method=='$disconnected')
                {
                    if (!this.worker)
                        return;
                    this.worker.terminate();
                    delete this.worker;
                }
                else if (this.worker)
                    this.worker.postMessage(data);
            });
        });
        let packager = await startPackager();
        if (!packager)
            return;
        await startDebugger();
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
        if (this.ws)
        {
            this.ws.close();
            delete this.ws;
        }
        this.setState({streams: null});
    };

    renderConsole = ({history})=>history.map(({id, data})=>(<div key={id}>{data}</div>));

    renderSide = ()=>{
        let {dir, tab, tabs} = this.state;
        return (
            <Layout.Sider id='menu' width={200}>
                <Menu onSelect={this.onTab} selectedKeys={[tab]} mode='inline' style={{border: 0}}>
                    {tabs.map(({title, key})=>title ? <Menu.Item key={key}>{title}</Menu.Item> :
                        <Menu.Divider key={key} />)
                    }
                    <Menu.Divider />
                </Menu>
                <Checklist dir={dir} />
            </Layout.Sider>
        );
    };

    onTreeSelect = path=>{
    };

    render(){
        let {dir, tab, tabs, streams} = this.state;
        return (
            <LocaleProvider locale={enUS}>
                <Layout>
                    <Layout.Header id='header'>
                        <Row id='toolbar'>
                            <ToolbarButton onClick={this.open} title='Load Project' disabled={streams}
                                icon='folder-o' />
                            <ToolbarButton onClick={this.start} title='Debug' disabled={!dir || streams} icon='play' />
                            <ToolbarButton onClick={this.stop} title='Stop' disabled={!streams} icon='stop' />
                        </Row>
                    </Layout.Header>
                    <Layout id='content'>
                        {null && <Layout.Sider id='tree'>
                            <FileTree dir={dir} onSelect={this.onTreeSelect} />
                        </Layout.Sider>}
                        {this.renderSide()}
                        <Layout.Content style={{marginLeft: 200}} id='console'>
                            {tabs[+tab].render()}
                        </Layout.Content>
                    </Layout>
                </Layout>
            </LocaleProvider>
        );
    }
}
