import App from './App.svelte';
import { mount } from 'svelte';
import './style.css';
import 'devicon/devicon.min.css';

mount(App, { target: document.getElementById('app')! });
