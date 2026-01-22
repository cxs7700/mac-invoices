import { useState, type ChangeEvent } from 'react'
import reactLogo from './assets/react.svg'
import viteLogo from '/vite.svg'
import './App.css'
import { Button } from "@/components/ui/button"
import { useForm } from "react-hook-form"

type InvoiceFields = {
  description: string,
  date: Date,
  location: string,
  price: number,
  status: string,
  number: number,
  quantity: number,
  creatorId: number
}

function App() {
  const [count, setCount] = useState(0)
  // const [fields, setFields] = useState({} as InvoiceFields);
  const {
    register,
    setValue,
    handleSubmit,
    formState: { errors }
  } = useForm<InvoiceFields>()
  // description, date, location, price, status, number, quantity, creatorId, creator

  const onChange = (e: ChangeEvent<HTMLInputElement>) => {
    const value = e?.target?.value;
    // setFields({
    //   ...fields,
    //   [`${e.target?.name}`]: value
    // })
  }

  const onSubmit = handleSubmit(data => console.log(data))

  return (
    <>
      <form style={{display: 'flex', flexDirection: 'column'}} onSubmit={onSubmit}>
        <label>Description</label>
        <input {...register("description")}/>

        <label>Date</label>
        <input {...register("date")}/>

        <label>Location</label>
        <input {...register("location")}/>

        <label>Price</label>
        <input {...register("price")}/>

        <label>Status</label>
        <input {...register("status")}/>

        <label>Number</label>
        <input {...register("number")}/>

        <label>Quantity</label>
        <input {...register("quantity")}/>

        {/* TODO: handle creator name/id */}
        <label>Creator ID</label>
        <input {...register("creatorId")}/>


        <input type="submit" />

      </form>
    </>
  )
}

export default App
