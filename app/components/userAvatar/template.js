const template = `

  <style>
  
    :host { 
		background: url(../resources/img/avatar.png);
		background-color: #1c2b3d;
		background-repeat: no-repeat !important;
		background-size: cover !important;
		background-position: center !important;
		width: 96px;
		height: 96px; 
		border: solid rgba(255, 255, 255, 0.86) 2px;
		margin: 10px 16px 10px 10px;
		box-shadow: 0 14px 34px rgba(0, 0, 0, 0.38), 0 0 0 5px rgba(108, 145, 255, 0.08);
		transition: transform 180ms ease, box-shadow 180ms ease;
    }
    
    :host(:hover) {
		cursor: pointer;
		transform: translateY(-2px);
		box-shadow: 0 18px 38px rgba(0, 0, 0, 0.44), 0 0 0 5px rgba(108, 145, 255, 0.18);
		color: #e7edf6;
	}
    
    :host(.round) {
		border-radius: 50%;
    }
  
  </style>

`;

export { template };
